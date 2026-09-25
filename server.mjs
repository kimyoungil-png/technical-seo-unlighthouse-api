import express from "express"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const app = express()

app.use(express.json({ limit: "1mb" }))

const PORT = process.env.PORT || 8080


app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Technical SEO Unlighthouse API"
  })
})


app.get("/health", (req, res) => {
  res.json({
    status: "ok"
  })
})


app.post("/audit", async (req, res) => {

  const { url } = req.body || {}

  if (!url) {
    return res.status(400).json({
      error: "url is required"
    })
  }

  let parsed

  try {
    parsed = new URL(url)
  } catch {
    return res.status(400).json({
      error: "invalid url"
    })
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return res.status(400).json({
      error: "only http and https URLs are supported"
    })
  }

  const site = `${parsed.protocol}//${parsed.host}`
  const path = parsed.pathname || "/"

  const outputDir = await mkdtemp(
    join(tmpdir(), "unlighthouse-")
  )

  const args = [
    "unlighthouse",
    "ci",
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

  const child = spawn(
    "npx",
    args,
    {
      env: {
        ...process.env,
        CHROME_PATH: "/usr/bin/chromium"
      }
    }
  )

  let stdout = ""
  let stderr = ""

  child.stdout.on("data", chunk => {
    stdout += chunk.toString()
  })

  child.stderr.on("data", chunk => {
    stderr += chunk.toString()
  })

  const timeout = setTimeout(() => {
    child.kill("SIGKILL")
  }, 300000)

  child.on("close", async code => {

    clearTimeout(timeout)

    if (code !== 0) {
      return res.status(500).json({
        success: false,
        code,
        stdout,
        stderr
      })
    }

    try {

      const files = await findJsonFiles(outputDir)

      const reports = []

      for (const file of files) {
        try {
          const text = await readFile(file, "utf8")
          reports.push(JSON.parse(text))
        } catch {
          // JSON以外は無視
        }
      }

      return res.json({
        success: true,
        url,
        site,
        path,
        reportCount: reports.length,
        reports,
        stdout
      })

    } catch (error) {

      return res.status(500).json({
        success: false,
        error: error.message,
        stdout,
        stderr
      })

    }

  })

})


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
