import express from "express"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const app = express()

app.use(express.json({ limit: "1mb" }))

const PORT = process.env.PORT || 8080
const API_VERSION = "metrics-v2"


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


app.post("/audit", async (req, res) => {
  const { url } = req.body || {}

  if (!url) {
    return res.status(400).json({
      success: false,
      error: "url is required"
    })
  }

  let parsed

  try {
    parsed = new URL(url)
  } catch {
    return res.status(400).json({
      success: false,
      error: "invalid url"
    })
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return res.status(400).json({
      success: false,
      error: "only http and https URLs are supported"
    })
  }

  const site = `${parsed.protocol}//${parsed.host}`
  const path = parsed.pathname || "/"

  const outputDir = await mkdtemp(
    join(tmpdir(), "unlighthouse-")
  )

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

  const child = spawn(
    command,
    args,
    {
      env: {
        ...process.env,
        CHROME_PATH: "/usr/bin/chromium",
        PUPPETEER_EXECUTABLE_PATH: "/usr/bin/chromium"
      }
    }
  )

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


function extractMetrics(report) {
  const categories = report?.summary?.categories || {}
  const metrics = report?.summary?.metrics || {}

  const categoryScore = key => {
    const value = categories?.[key]?.averageScore
    return typeof value === "number"
      ? Math.round(value * 100)
      : null
  }

  const metricAverage = key => {
    const value = metrics?.[key]?.averageNumericValue
    return typeof value === "number"
      ? value
      : null
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
    const entries = await readdir(
      current,
      {
        withFileTypes: true
      }
    )

    for (const entry of entries) {
      const full = join(
        current,
        entry.name
      )

      if (entry.isDirectory()) {
        await walk(full)
      }

      if (
        entry.isFile() &&
        entry.name.endsWith(".json")
      ) {
        results.push(full)
      }
    }
  }

  await walk(dir)

  return results
}


app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Server listening on port ${PORT}`
    )
  }
)
