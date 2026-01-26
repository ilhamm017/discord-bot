const fs = require("fs");
const os = require("os");
const path = require("path");
const { PassThrough } = require("stream");
const { spawn } = require("child_process");
const YTDlpWrap = require("yt-dlp-wrap").default;

const dataDir = path.join(process.cwd(), ".data");
const binaryName = os.platform() === "win32" ? "yt-dlp.exe" : "yt-dlp";
const binaryPath = path.join(dataDir, binaryName);
const cookiesPath = path.join(dataDir, "cookies.txt");

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

    if (fs.existsSync(cookiesPath)) {
        args.push("--cookies", cookiesPath);
    }

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

async function searchWithYtDlp(query, limit = 5) {
    if (!query) return [];
    const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 25));
    const binary = await ensureBinary();
    const args = [
        `ytsearch${safeLimit}:${query}`,
        "--no-playlist",
        "--skip-download",
        "--dump-json",
        "--no-warnings",
        "--no-progress",
        "-q",
    ];

    if (fs.existsSync(cookiesPath)) {
        args.push("--cookies", cookiesPath);
    }

    return new Promise((resolve, reject) => {
        const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        child.on("error", (error) => {
            reject(error);
        });

        child.on("close", (code) => {
            if (code !== 0) {
                const wrapped = new Error("YTDLP_SEARCH_FAILED");
                wrapped.cause = new Error(stderr || `exit_${code}`);
                reject(wrapped);
                return;
            }

            const results = [];
            const lines = stdout.split(/\r?\n/).filter(Boolean);
            for (const line of lines) {
                try {
                    const item = JSON.parse(line);
                    if (!item) continue;
                    const url =
                        item.webpage_url ||
                        item.url ||
                        (item.id ? `https://www.youtube.com/watch?v=${item.id}` : null);
                    if (!url) continue;
                    results.push({
                        id: item.id,
                        url,
                        title: item.title || url,
                        duration: Number.isFinite(item.duration) ? item.duration : null,
                    });
                } catch (error) {
                    continue;
                }
            }
            resolve(results);
        });
    });
}

async function getInfoWithYtDlp(url) {
    if (!url) return null;
    const binary = await ensureBinary();
    const args = [
        url,
        "--no-playlist",
        "--skip-download",
        "--dump-json",
        "--no-warnings",
        "--no-progress",
        "-q",
    ];

    if (fs.existsSync(cookiesPath)) {
        args.push("--cookies", cookiesPath);
    }

    return new Promise((resolve, reject) => {
        const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        child.on("error", (error) => {
            reject(error);
        });

        child.on("close", (code) => {
            if (code !== 0) {
                const wrapped = new Error("YTDLP_INFO_FAILED");
                wrapped.cause = new Error(stderr || `exit_${code}`);
                reject(wrapped);
                return;
            }

            try {
                const data = JSON.parse(stdout.trim());
                resolve(data);
            } catch (error) {
                const wrapped = new Error("YTDLP_INFO_INVALID");
                wrapped.cause = error;
                reject(wrapped);
            }
        });
    });
}

module.exports = {
    getInfoWithYtDlp,
    searchWithYtDlp,
    streamWithYtDlp,
};
