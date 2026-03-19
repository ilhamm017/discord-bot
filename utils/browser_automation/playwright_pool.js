const logger = require("../logger");

function clampInt(value, min, max, fallback) {
  const num = Number.isFinite(Number(value)) ? Number(value) : fallback;
  const int = Number.isInteger(num) ? num : Math.floor(num);
  return Math.max(min, Math.min(max, int));
}

let browserPromise = null;
let browser = null;

async function getChromiumBrowser({ headless = true, timeoutMs = 15000 } = {}) {
  if (browser) return browser;
  if (browserPromise) return browserPromise;

  const ms = clampInt(timeoutMs, 2000, 60000, 15000);

  browserPromise = (async () => {
    const { chromium } = require("playwright");
    const b = await chromium.launch({
      headless: headless !== false,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-setuid-sandbox",
      ],
      timeout: ms,
    });
    browser = b;
    return b;
  })();

  try {
    return await browserPromise;
  } catch (error) {
    browserPromise = null;
    throw error;
  }
}

async function closeChromiumBrowser() {
  try {
    await browser?.close?.();
  } catch (error) {
    logger.debug("Failed to close Playwright browser", { error: error?.message || String(error) });
  } finally {
    browser = null;
    browserPromise = null;
  }
}

let hooked = false;
function hookProcessExit() {
  if (hooked) return;
  hooked = true;
  const handler = () => closeChromiumBrowser().catch(() => { });
  process.on("exit", handler);
  process.on("SIGINT", () => handler().finally(() => process.exit(130)));
  process.on("SIGTERM", () => handler().finally(() => process.exit(143)));
}

module.exports = {
  getChromiumBrowser,
  closeChromiumBrowser,
  hookProcessExit,
};

