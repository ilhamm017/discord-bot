const fs = require("fs");
const os = require("os");
const path = require("path");
const { PassThrough } = require("stream");
const { spawn } = require("child_process");
const YTDlpWrap = require("yt-dlp-wrap").default;

const dataDir = path.join(__dirname, "..", ".data");
const binaryName = os.platform() === "win32" ? "yt-dlp.exe" : "yt-dlp";
const binaryPath = path.join(dataDir, binaryName);

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

async function streamWithYtDlp(url) {
  const binary = await ensureBinary();
  const args = [
    url,
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "-q",
    "-f",
    "bestaudio[acodec=opus]/bestaudio",
    "--retries",
    "3",
    "--fragment-retries",
    "3",
    "--socket-timeout",
    "10",
    "-o",
    "-",
  ];

  try {
    const stream = new PassThrough();
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let closed = false;

    child.stdout.pipe(stream);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (closed) return;
      closed = true;
      stream.destroy(error);
    });

    child.on("close", (code) => {
      if (closed) return;
      closed = true;
      if (code === 0) {
        stream.end();
      } else {
        const wrapped = new Error("YTDLP_EXEC_FAILED");
        wrapped.cause = new Error(stderr || `exit_${code}`);
        stream.destroy(wrapped);
      }
    });

    stream.on("close", () => {
      if (!child.killed) {
        child.kill();
      }
    });

    return stream;
  } catch (error) {
    const wrapped = new Error("YTDLP_EXEC_FAILED");
    wrapped.cause = error;
    throw wrapped;
  }
}

module.exports = {
  streamWithYtDlp,
};
