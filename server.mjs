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
const PPT_FONT_FACE = "Meiryo"


app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Technical SEO Unlighthouse API",
    version: API_VERSION,
  })
})


app.get("/health", (req, res) => {
  res.json({ status: "ok", version: API_VERSION })
})


async function captureMobileScreenshot(url) {
  let browser

  try {
    browser = await puppeteer.launch({
      executablePath: "/usr/bin/chromium",
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    })

    const page = await browser.newPage()

    await page.setViewport({
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    })

    await page.setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 " +
      "Mobile/15E148 Safari/604.1"
    )

    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 })
    await new Promise(resolve => setTimeout(resolve, 1500))

    return await page.screenshot({ type: "png", fullPage: false })
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
}


app.post("/screenshot", async (req, res) => {
  const { url } = req.body || {}

  if (!url) {
    return res.status(400).json({ success: false, error: "url is required" })
  }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return res.status(400).json({ success: false, error: "invalid url" })
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return res.status(400).json({ success: false, error: "only http and https URLs are supported" })
  }

  try {
    const screenshot = await captureMobileScreenshot(url)
    return res.json({
      success: true,
      viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
      imageBase64: Buffer.from(screenshot).toString("base64"),
    })
  } catch (error) {
    console.error("SCREENSHOT ERROR:", error)
    return res.status(500).json({ success: false, error: error.message })
  }
})


app.post("/report-ppt", async (req, res) => {
  const { url, checks, summaryText } = req.body || {}

  if (!url || !Array.isArray(checks)) {
    return res.status(400).json({ success: false, error: "url and checks are required" })
  }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return res.status(400).json({ success: false, error: "invalid url" })
  }

  try {
    const screenshot = await captureMobileScreenshot(url)

    const pptx = new PptxGenJS()
    pptx.layout = "LAYOUT_WIDE"
    pptx.author = "Ascent SEO Team"
    pptx.subject = "Technical SEO Check Report"
    pptx.title = "Technical SEO Checker"
    pptx.company = "Ascent Networks"
    pptx.lang = "ja-JP"
    pptx.theme = {
      headFontFace: PPT_FONT_FACE,
      bodyFontFace: PPT_FONT_FACE,
      lang: "ja-JP",
    }

    const slide = pptx.addSlide()
    slide.background = { color: "FFFFFF" }

    const slideW = 13.333
    const slideH = 7.5

    slide.addText("Technical SEO Checker", {
      x: 0.45, y: 0.12, w: 3.5, h: 0.22,
      fontFace: PPT_FONT_FACE, fontSize: 10,
      color: "777777", bold: true,
      margin: 0,
    })

    slide.addText("Confidential", {
      x: 11.73, y: 0.08, w: 1.15, h: 0.28,
      fontFace: PPT_FONT_FACE, fontSize: 13,
      color: "FF0000", bold: true,
      align: "center", valign: "mid",
      margin: 0.02,
      line: { color: "FF0000", width: 1 },
      radius: 0.08,
    })

    const pathLabel = parsed.pathname || "/"
    const dateLabel = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "numeric",
      day: "numeric",
    }).format(new Date())

    slide.addText(`${pathLabel}（${dateLabel}時点チェック）`, {
      x: 0.45, y: 0.42, w: 8.7, h: 0.28,
      fontFace: PPT_FONT_FACE, fontSize: 17,
      color: "111111", bold: true,
      margin: 0,
    })

    const ngCount = checks.filter(row => row.Status === "NG").length
    const warnCount = checks.filter(row => row.Status === "△").length

    let summary = String(summaryText || "").trim()
    if (!summary) {
      if (ngCount > 0) {
        summary = `要修正（NG）が${ngCount}件検出されました。優先して修正内容を確認してください。`
      } else if (warnCount > 0) {
        summary = `重大なエラーはありません。要確認（△）が${warnCount}件あります。公開意図と照らして確認してください。`
      } else {
        summary = "重大なTechnical SEOエラーは検出されませんでした。"
      }
    }

    slide.addText(summary, {
      x: 0.45, y: 0.69, w: 9.0, h: 0.4,
      fontFace: PPT_FONT_FACE, fontSize: 14,
      color: "003CFF", bold: true,
      margin: 0,
      fit: "shrink",
    })

    const phoneX = 0.38
    const phoneY = 1.22
    const phoneW = 2.95
    const phoneH = 6.05

    // Phone frame inspired by the provided mock image: black base + layered gray outlines.
    slide.addShape(pptx.ShapeType.roundRect, {
      x: phoneX, y: phoneY, w: phoneW, h: phoneH,
      rectRadius: 0.22,
      fill: { color: "000000" },
      line: { color: "9B9B9B", width: 1.25 },
    })

    slide.addImage({
      data: `data:image/png;base64,${Buffer.from(screenshot).toString("base64")}`,
      x: phoneX + 0.19,
      y: phoneY + 0.25,
      w: phoneW - 0.38,
      h: phoneH - 0.50,
    })

    for (const frame of [
      { inset: 0.08, color: "B0B0B0", width: 1.05 },
      { inset: 0.16, color: "A0A0A0", width: 0.9 },
    ]) {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: phoneX + frame.inset,
        y: phoneY + frame.inset,
        w: phoneW - frame.inset * 2,
        h: phoneH - frame.inset * 1.65,
        rectRadius: 0.20,
        fill: { color: "FFFFFF", transparency: 100 },
        line: { color: frame.color, width: frame.width },
      })
    }

    const tableRows = [
      [
        { text: "No", options: { bold: true, align: "center", fontFace: PPT_FONT_FACE } },
        { text: "チェック項目", options: { bold: true, align: "center", fontFace: PPT_FONT_FACE } },
        { text: "結果", options: { bold: true, align: "center", fontFace: PPT_FONT_FACE } },
        { text: "判定", options: { bold: true, align: "center", fontFace: PPT_FONT_FACE } },
      ],
    ]

    for (const row of checks) {
      let resultText = String(row.Result || "")
      const actionText = String(row.Action || "")

      if (actionText && actionText !== "対応不要") {
        resultText += `\nコメント: ${actionText}`
      }

      tableRows.push([
        String(row.No),
        `${row.Item}\n${row.Meaning}`,
        resultText,
        String(row.Status),
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
      fontFace: PPT_FONT_FACE,
      fontSize: 6.5,
      margin: 0.03,
      valign: "mid",
      breakLine: false,
      autoFit: false,
      colW: [0.38, 3.25, 5.18, 0.55],
      rowH: 0.29,
      bold: false,
    })

    const fileBuffer = await pptx.write({ outputType: "nodebuffer" })

    return res.json({
      success: true,
      fileBase64: Buffer.from(fileBuffer).toString("base64"),
      filename: "technical-seo-report.pptx",
    })
  } catch (error) {
    console.error("PPT REPORT ERROR:", error)
    return res.status(500).json({ success: false, error: error.message })
  }
})


app.post("/audit", async (req, res) => {
  const { url } = req.body || {}

  if (!url) {
    return res.status(400).json({ success: false, error: "url is required" })
  }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return res.status(400).json({ success: false, error: "invalid url" })
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return res.status(400).json({ success: false, error: "only http and https URLs are supported" })
  }

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
    "--config-file", "unlighthouse.config.mjs",
    "--site", site,
    "--urls", path,
    "--output-path", outputDir,
    "--reporter", "jsonExpanded",
    "--no-cache",
  ]

  const child = spawn(command, args, {
    env: {
      ...process.env,
      CHROME_PATH: "/usr/bin/chromium",
      PUPPETEER_EXECUTABLE_PATH: "/usr/bin/chromium",
    },
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
      return res.status(500).json({ success: false, code, error: "Unlighthouse failed", stdout, stderr })
    }

    try {
      const files = await findJsonFiles(outputDir)
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
        return res.status(500).json({ success: false, error: "No jsonExpanded Unlighthouse report found", stdout, stderr })
      }

      const metrics = extractMetrics(expandedReport)
      console.log("AUDIT COMPLETE")
      console.log("METRICS:", metrics)

      return res.json({ success: true, version: API_VERSION, url, site, path, metrics })
    } catch (error) {
      console.error("REPORT READ ERROR:", error)
      return res.status(500).json({ success: false, error: error.message, stdout, stderr })
    }
  })
})


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
    tbt: formatTbt(tbtMs),
  }
}


function formatMs(value) {
  if (typeof value !== "number") return null
  return `${(value / 1000).toFixed(2)} s`
}


function formatTbt(value) {
  if (typeof value !== "number") return null
  return `${Math.round(value)} ms`
}


function formatCls(value) {
  if (typeof value !== "number") return null
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
