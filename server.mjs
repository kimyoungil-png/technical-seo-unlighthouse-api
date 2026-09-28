import express from "express"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import puppeteer from "puppeteer-core"
import PptxGenJS from "pptxgenjs"

const app = express()

app.use(express.json({ limit: "2mb" }))

const PORT = process.env.PORT || 8080
const API_VERSION = "metrics-v2"
const FONT = "Meiryo"
const CHROME_PATH = "/usr/bin/chromium"


app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Technical SEO Unlighthouse API",
    version: API_VERSION
  })
})


app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: API_VERSION
  })
})


app.post("/screenshot", async (req, res) => {
  const { url } = req.body || {}

  const validation = validateUrl(url)
  if (!validation.ok) {
    return res.status(validation.status).json(validation.body)
  }

  let browser

  try {
    browser = await launchBrowser()
    const page = await openMobilePage(browser, url)
    const screenshot = await page.screenshot({
      type: "png",
      fullPage: false
    })

    return res.json({
      success: true,
      viewport: {
        width: 390,
        height: 844,
        deviceScaleFactor: 2
      },
      imageBase64: Buffer.from(screenshot).toString("base64")
    })
  } catch (error) {
    console.error("SCREENSHOT ERROR:", error)

    return res.status(500).json({
      success: false,
      error: error.message
    })
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
})


app.post("/report-ppt", async (req, res) => {
  const { url, checks, summary } = req.body || {}

  if (!url || !Array.isArray(checks)) {
    return res.status(400).json({
      success: false,
      error: "url and checks are required"
    })
  }

  const validation = validateUrl(url)
  if (!validation.ok) {
    return res.status(validation.status).json(validation.body)
  }

  const parsed = validation.parsed
  let browser

  try {
    browser = await launchBrowser()
    const page = await openMobilePage(browser, url)
    const screenshot = await page.screenshot({
      type: "png",
      fullPage: false
    })

    const pptx = new PptxGenJS()
    pptx.layout = "LAYOUT_WIDE"
    pptx.author = "Ascent SEO Team"
    pptx.subject = "Technical SEO Check Report"
    pptx.title = "Technical SEO Checker"
    pptx.company = "Ascent Networks"
    pptx.lang = "ja-JP"
    pptx.theme = {
      headFontFace: FONT,
      bodyFontFace: FONT,
      lang: "ja-JP"
    }

    const slide = pptx.addSlide()
    slide.background = { color: "FFFFFF" }

    const slideW = 13.333
    const slideH = 7.5

    slide.addText("Technical SEO Checker", {
      x: 0.45,
      y: 0.12,
      w: 3.5,
      h: 0.22,
      fontFace: FONT,
      fontSize: 10,
      color: "777777",
      bold: true,
      margin: 0
    })

    slide.addText("Confidential", {
      x: 11.73,
      y: 0.08,
      w: 1.15,
      h: 0.28,
      fontFace: FONT,
      fontSize: 13,
      color: "FF0000",
      bold: true,
      align: "center",
      valign: "mid",
      margin: 0.02,
      line: { color: "FF0000", width: 1 },
      radius: 0.08
    })

    const pathLabel = parsed.pathname || "/"
    const dateLabel = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "numeric",
      day: "numeric"
    }).format(new Date())

    slide.addText(`${pathLabel}（${dateLabel}時点チェック）`, {
      x: 0.45,
      y: 0.42,
      w: 8.7,
      h: 0.28,
      fontFace: FONT,
      fontSize: 17,
      color: "111111",
      bold: true,
      margin: 0
    })

    const summaryText = buildSummaryText(summary, checks)

    slide.addText(summaryText, {
      x: 0.45,
      y: 0.69,
      w: 9.0,
      h: 0.38,
      fontFace: FONT,
      fontSize: 15,
      color: "003CFF",
      bold: true,
      margin: 0,
      breakLine: false,
      fit: "shrink"
    })

    const phoneX = 0.38
    const phoneY = 1.22
    const phoneW = 2.95
    const phoneH = 6.05

    for (const offset of [0, 0.08, 0.16]) {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: phoneX + offset,
        y: phoneY + offset,
        w: phoneW - offset * 2,
        h: phoneH - offset * 1.6,
        rectRadius: 0.14,
        fill: { color: "FFFFFF", transparency: 100 },
        line: { color: "A5A5A5", width: 1 }
      })
    }

    slide.addImage({
      data: `data:image/png;base64,${Buffer.from(screenshot).toString("base64")}`,
      x: phoneX + 0.27,
      y: phoneY + 0.26,
      w: phoneW - 0.54,
      h: phoneH - 0.5
    })

    const tableRows = [
      [
        { text: "No", options: { bold: true, align: "center" } },
        { text: "チェック項目", options: { bold: true, align: "center" } },
        { text: "結果", options: { bold: true, align: "center" } },
        { text: "判定", options: { bold: true, align: "center" } }
      ]
    ]

    for (const row of checks) {
      let resultText = String(row.Result || "")
      const actionText = String(row.Action || "")

      if (actionText && actionText !== "対応不要") {
        resultText += `\nコメント: ${actionText}`
      }

      const itemText = `${row.Item}\n${row.Meaning}`

      tableRows.push([
        String(row.No),
        itemText,
        resultText,
        String(row.Status)
      ])
    }

    const tableX = 3.45
    const tableY = 1.24
    const tableW = slideW - tableX - 0.45

    slide.addTable(tableRows, {
      x: tableX,
      y: tableY,
      w: tableW,
      h: slideH - tableY - 0.28,
      border: { type: "solid", color: "D9D9D9", pt: 0.5 },
      fill: "FFFFFF",
      color: "111111",
      fontFace: FONT,
      fontSize: 6.5,
      margin: 0.03,
      valign: "mid",
      breakLine: false,
      autoFit: false,
      colW: [0.38, 3.25, 5.18, 0.55],
      rowH: 0.29,
      bold: false
    })

    const fileBuffer = await pptx.write({
      outputType: "nodebuffer"
    })

    return res.json({
      success: true,
      fileBase64: Buffer.from(fileBuffer).toString("base64"),
      filename: "technical-seo-report.pptx"
    })
  } catch (error) {
    console.error("PPT REPORT ERROR:", error)

    return res.status(500).json({
      success: false,
      error: error.message
    })
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
})


app.post("/audit", async (req, res) => {
  const { url } = req.body || {}

  const validation = validateUrl(url)
  if (!validation.ok) {
    return res.status(validation.status).json(validation.body)
  }

  const parsed = validation.parsed
  const site = `${parsed.protocol}//${parsed.host}`
  const path = parsed.pathname || "/"
  const outputDir = await mkdtemp(join(tmpdir(), "unlighthouse-"))

  console.log("AUDIT START")
  console.log("URL:", url)
  console.log("SITE:", site)
  console.log("PATH:", path)
  console.log("OUTPUT:", outputDir)

  const command = "./node_modules/.bin/unlighthouse-ci"
  const args = [
    "--config-file",
    "unlighthouse.config.mjs",
    "--site",
    site,
    "--urls",
    path,
    "--output-path",
    outputDir,
    "--reporter",
    "jsonExpanded",
    "--no-cache"
  ]

  console.log("COMMAND:", command, args.join(" "))

  const child = spawn(command, args, {
    env: {
      ...process.env,
      CHROME_PATH,
      PUPPETEER_EXECUTABLE_PATH: CHROME_PATH
    }
  })

  let stdout = ""
  let stderr = ""

  child.stdout.on("data", chunk => {
    const text = chunk.toString()
    stdout += text
    console.log("[UNLIGHTHOUSE]", text.trim())
  })

  child.stderr.on("data", chunk => {
    const text = chunk.toString()
    stderr += text
    console.error("[UNLIGHTHOUSE ERROR]", text.trim())
  })

  const timeout = setTimeout(() => {
    console.error("AUDIT TIMEOUT: killing child process")
    child.kill("SIGKILL")
  }, 300000)

  child.on("close", async code => {
    clearTimeout(timeout)
    console.log("UNLIGHTHOUSE EXIT CODE:", code)

    if (code !== 0) {
      return res.status(500).json({
        success: false,
        code,
        error: "Unlighthouse failed",
        stdout,
        stderr
      })
    }

    try {
      const files = await findJsonFiles(outputDir)
      console.log("JSON FILES:", files.length)

      let expandedReport = null

      for (const file of files) {
        try {
          const text = await readFile(file, "utf8")
          const data = JSON.parse(text)

          if (
            data &&
            typeof data === "object" &&
            !Array.isArray(data) &&
            data.summary &&
            data.summary.categories &&
            data.summary.metrics &&
            Array.isArray(data.routes)
          ) {
            expandedReport = data
            break
          }
        } catch {
          // invalid or unrelated JSON is ignored
        }
      }

      if (!expandedReport) {
        return res.status(500).json({
          success: false,
          error: "No jsonExpanded Unlighthouse report found",
          stdout,
          stderr
        })
      }

      const metrics = extractMetrics(expandedReport)
      console.log("AUDIT COMPLETE")
      console.log("METRICS:", metrics)

      return res.json({
        success: true,
        version: API_VERSION,
        url,
        site,
        path,
        metrics
      })
    } catch (error) {
      console.error("REPORT READ ERROR:", error)

      return res.status(500).json({
        success: false,
        error: error.message,
        stdout,
        stderr
      })
    }
  })
})


function validateUrl(url) {
  if (!url) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        error: "url is required"
      }
    }
  }

  try {
    const parsed = new URL(url)

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        ok: false,
        status: 400,
        body: {
          success: false,
          error: "only http and https URLs are supported"
        }
      }
    }

    return {
      ok: true,
      parsed
    }
  } catch {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        error: "invalid url"
      }
    }
  }
}


async function launchBrowser() {
  return puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  })
}


async function openMobilePage(browser, url) {
  const page = await browser.newPage()

  await page.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  })

  await page.setUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 " +
    "Mobile/15E148 Safari/604.1"
  )

  await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 45000
  })

  await new Promise(resolve => setTimeout(resolve, 1500))

  return page
}


function buildSummaryText(summary, checks) {
  const cleanSummary = String(summary || "").trim()

  if (cleanSummary) {
    return cleanSummary
  }

  const ngCount = checks.filter(row => row.Status === "NG").length
  const warnCount = checks.filter(row => row.Status === "△").length

  if (ngCount > 0) {
    return `要修正（NG）が${ngCount}件検出されました。公開前に優先確認してください。`
  }

  if (warnCount > 0) {
    return `重大なエラーはありません。要確認（△）が${warnCount}件あります。`
  }

  return "重大なTechnical SEOエラーは検出されませんでした。"
}


function extractMetrics(report) {
  const categories = report?.summary?.categories || {}
  const metrics = report?.summary?.metrics || {}

  const categoryScore = key => {
    const value = categories?.[key]?.averageScore
    return typeof value === "number" ? Math.round(value * 100) : null
  }

  const metricAverage = key => {
    const value = metrics?.[key]?.averageNumericValue
    return typeof value === "number" ? value : null
  }

  const lcpMs = metricAverage("largest-contentful-paint")
  const clsValue = metricAverage("cumulative-layout-shift")
  const fcpMs = metricAverage("first-contentful-paint")
  const tbtMs = metricAverage("total-blocking-time")

  return {
    performance: categoryScore("performance"),
    seo: categoryScore("seo"),
    accessibility: categoryScore("accessibility"),
    bestPractices: categoryScore("best-practices"),
    lcpMs,
    lcp: formatMs(lcpMs),
    clsValue,
    cls: formatCls(clsValue),
    fcpMs,
    fcp: formatMs(fcpMs),
    tbtMs,
    tbt: formatTbt(tbtMs)
  }
}


function formatMs(value) {
  if (typeof value !== "number") {
    return null
  }

  return `${(value / 1000).toFixed(2)} s`
}


function formatTbt(value) {
  if (typeof value !== "number") {
    return null
  }

  return `${Math.round(value)} ms`
}


function formatCls(value) {
  if (typeof value !== "number") {
    return null
  }

  return value.toFixed(3)
}


async function findJsonFiles(dir) {
  const results = []

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true })

    for (const entry of entries) {
      const full = join(current, entry.name)

      if (entry.isDirectory()) {
        await walk(full)
      }

      if (entry.isFile() && entry.name.endsWith(".json")) {
        results.push(full)
      }
    }
  }

  await walk(dir)
  return results
}


app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`)
})
