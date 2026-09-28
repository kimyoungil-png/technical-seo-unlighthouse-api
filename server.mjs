import express from "express"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import puppeteer from "puppeteer-core"

const app = express()

app.use(express.json({ limit: "2mb" }))

const PORT = process.env.PORT || 8080
const API_VERSION = "metrics-v3"


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


let sharedBrowser = null

async function getSharedBrowser() {
  if (sharedBrowser?.connected) {
    return sharedBrowser
  }

  sharedBrowser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  })

  sharedBrowser.on("disconnected", () => {
    sharedBrowser = null
  })

  return sharedBrowser
}


async function captureMobileScreenshot(url) {
  const browser = await getSharedBrowser()
  const context = await browser.createBrowserContext()

  try {
    const page = await context.newPage()

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
    await context.close().catch(() => {})
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

  const MAX_LOG_CHARS = 200_000
  let stdout = ""
  let stderr = ""

  const appendLimited = (current, text) => {
    const combined = current + text
    return combined.length > MAX_LOG_CHARS
      ? combined.slice(-MAX_LOG_CHARS)
      : combined
  }

  child.stdout.on("data", chunk => {
    const text = chunk.toString()
    stdout = appendLimited(stdout, text)
    console.log("[UNLIGHTHOUSE]", text.trim())
  })

  child.stderr.on("data", chunk => {
    const text = chunk.toString()
    stderr = appendLimited(stderr, text)
    console.error("[UNLIGHTHOUSE ERROR]", text.trim())
  })

  const timeout = setTimeout(() => {
    console.error("AUDIT TIMEOUT: killing child process")
    child.kill("SIGKILL")
  }, 300000)

  child.on("close", async code => {
    clearTimeout(timeout)
    console.log("UNLIGHTHOUSE EXIT CODE:", code)

    try {
      if (code !== 0) {
        return res.status(500).json({
          success: false,
          code,
          error: "Unlighthouse failed",
          stdout,
          stderr,
        })
      }

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
        return res.status(500).json({
          success: false,
          error: "No jsonExpanded Unlighthouse report found",
          stdout,
          stderr,
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
        metrics,
      })
    } catch (error) {
      console.error("REPORT READ ERROR:", error)
      return res.status(500).json({
        success: false,
        error: error.message,
        stdout,
        stderr,
      })
    } finally {
      await rm(outputDir, { recursive: true, force: true }).catch(() => {})
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


process.on("SIGTERM", async () => {
  const browser = sharedBrowser
  sharedBrowser = null

  if (browser) {
    await browser.close().catch(() => {})
  }

  process.exit(0)
})


app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`)
})
