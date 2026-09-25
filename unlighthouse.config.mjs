export default {
  puppeteerOptions: {
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  },

  puppeteerClusterOptions: {
    maxConcurrency: 1
  },

  cache: false
}
