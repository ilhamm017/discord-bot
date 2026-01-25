const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const YTDlpWrap = require("yt-dlp-wrap").default;

const dataDir = path.join(__dirname, "..", ".data");
const binaryName = os.platform() === "win32" ? "yt-dlp.exe" : "yt-dlp";
const binaryPath = path.join(dataDir, binaryName);

let ytDlpWrapPromise;

async function ensureBinary() {
  if (fs.existsSync(binaryPath)) return binaryPath;

  fs.mkdirSync(dataDir, { recursive: true });
  try {
    await YTDlpWrap.downloadFromGithub(binaryPath);
  } catch (error) {
    const wrapped = new Error("YTDLP_DOWNLOAD_FAILED");
    wrapped.cause = error;
    throw wrapped;
  }

  if (os.platform() !== "win32") {
    fs.chmodSync(binaryPath, 0o755);
  }

  return binaryPath;
}

async function getYtDlpWrap() {
  if (!ytDlpWrapPromise) {
    ytDlpWrapPromise = (async () => {
      const binary = await ensureBinary();
      return new YTDlpWrap(binary);
    })();
  }

  return ytDlpWrapPromise;
}

async function getStreamUrl(url) {
  const ytDlpWrap = await getYtDlpWrap();
  const args = [
    url,
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "-q",
    "-f",
    "bestaudio[acodec=opus]/bestaudio",
    "-g",
  ];

  let stdout;
  try {
    stdout = await ytDlpWrap.execPromise(args);
  } catch (error) {
    const wrapped = new Error("YTDLP_EXEC_FAILED");
    wrapped.cause = error;
    throw wrapped;
  }

  const line = String(stdout)
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);

  if (!line) {
    throw new Error("YTDLP_NO_URL");
  }

  return line;
}

async function streamWithYtDlp(url) {
  const streamUrl = await getStreamUrl(url);

  let response;
  try {
    response = await fetch(streamUrl);
  } catch (error) {
    const wrapped = new Error("YTDLP_FETCH_FAILED");
    wrapped.cause = error;
    throw wrapped;
  }

  if (!response.ok || !response.body) {
    const wrapped = new Error("YTDLP_FETCH_FAILED");
    wrapped.cause = new Error(`HTTP_${response.status}`);
    throw wrapped;
  }

  return Readable.fromWeb(response.body);
}

module.exports = {
  streamWithYtDlp,
};
