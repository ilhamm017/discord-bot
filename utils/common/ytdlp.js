const fs = require("fs");
const os = require("os");
const path = require("path");
const { PassThrough } = require("stream");
const { spawn } = require("child_process");
const YTDlpWrap = require("yt-dlp-wrap").default;

const dataDir = path.join(process.cwd(), ".data");
const binaryName = os.platform() === "win32" ? "yt-dlp.exe" : "yt-dlp";
const binaryPath = path.join(dataDir, binaryName);
const tempDir = path.join(dataDir, "tmp");
let binaryRefreshAttempted = false;

let config = {};
try {
    config = require(path.join(process.cwd(), "config.json"));
} catch (error) {
    config = {};
}

function getCookiesPath() {
    const configuredPath =
        process.env.YTDLP_COOKIES_PATH ||
        config.ytdlp_cookies_path ||
        config.ytdlpCookiesPath ||
        "";
    if (configuredPath) {
        const resolved = path.resolve(process.cwd(), configuredPath);
        if (fs.existsSync(resolved)) return resolved;
    }

    const localDefault = path.join(dataDir, "cookies.txt");
    if (fs.existsSync(localDefault)) return localDefault;
    return null;
}

function appendCookiesArg(args) {
    const cookiesPath = getCookiesPath();
    if (cookiesPath) {
        args.push("--cookies", cookiesPath);
    }
    return args;
}

function isYoutubeUrl(url) {
    if (!url) return false;
    return /(?:youtube\.com|youtu\.be)/i.test(String(url));
}

function appendYoutubeExtractorArgs(args, url) {
    if (!isYoutubeUrl(url)) return args;
    args.push("--extractor-args", "youtube:player_client=android,web");
    return args;
}

function appendYoutubeJsRuntimeArgs(args, url) {
    if (!isYoutubeUrl(url)) return args;
    args.push("--js-runtimes", `node:${process.execPath}`);
    return args;
}

function buildRuntimeCookiesPath(sourcePath) {
    fs.mkdirSync(tempDir, { recursive: true });
    const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return path.join(tempDir, `cookies-${suffix}.txt`);
}

function prepareCookiesArgs(args) {
    const cookiesPath = getCookiesPath();
    if (!cookiesPath) {
        return {
            args,
            cleanup: () => { },
        };
    }

    const runtimeCookiesPath = buildRuntimeCookiesPath(cookiesPath);
    fs.copyFileSync(cookiesPath, runtimeCookiesPath);

    return {
        args: [...args, "--cookies", runtimeCookiesPath],
        cleanup: () => {
            try {
                fs.unlinkSync(runtimeCookiesPath);
            } catch (error) {
                // Ignore temp cleanup failures.
            }
        },
    };
}

async function downloadBinary(force = false) {
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

async function ensureBinary() {
    if (fs.existsSync(binaryPath)) return binaryPath;
    return downloadBinary();
}

async function refreshBinary() {
    binaryRefreshAttempted = true;
    return downloadBinary(true);
}

async function streamWithYtDlp(url) {
    const binary = await ensureBinary();
    const baseArgs = appendYoutubeJsRuntimeArgs(appendYoutubeExtractorArgs([
        url,
        "--no-playlist",
        "--no-warnings",
        "--no-progress",
        "--force-ipv4",
        "-q",
        "-f",
        "bestaudio/best",
        "--retries",
        "3",
        "--fragment-retries",
        "3",
        "--socket-timeout",
        "10",
        "-o",
        "-",
    ]), url);
    const { args, cleanup } = prepareCookiesArgs(baseArgs);

    try {
        const stream = new PassThrough({ highWaterMark: 10 * 1024 * 1024 }); // 10MB Buffer
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
            cleanup();
            if (!child.killed) {
                child.kill();
            }
        });

        return stream;
    } catch (error) {
        cleanup();
        const wrapped = new Error("YTDLP_EXEC_FAILED");
        wrapped.cause = error;
        throw wrapped;
    }
}

async function searchWithYtDlp(query, limit = 5) {
    if (!query) return [];
    const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 25));
    const binary = await ensureBinary();
    const baseArgs = [
        `ytsearch${safeLimit}:${query}`,
        "--no-playlist",
        "--skip-download",
        "--force-ipv4",
        "--dump-json",
        "--no-warnings",
        "--no-progress",
        "-q",
    ];
    const { args, cleanup } = prepareCookiesArgs(baseArgs);

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
            cleanup();
            reject(error);
        });

        child.on("close", (code) => {
            cleanup();
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
    const baseArgs = appendYoutubeJsRuntimeArgs(appendYoutubeExtractorArgs([
        url,
        "--no-playlist",
        "--skip-download",
        "--force-ipv4",
        "--dump-json",
        "--no-warnings",
        "--no-progress",
        "-q",
    ]), url);
    const { args, cleanup } = prepareCookiesArgs(baseArgs);

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
            cleanup();
            reject(error);
        });

        child.on("close", (code) => {
            cleanup();
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

function buildDownloadArgVariants(url, outputTemplate) {
    const variants = [
        appendYoutubeJsRuntimeArgs([
            url,
            "--no-playlist",
            "--no-progress",
            "--no-simulate",
            "--force-ipv4",
            "-f",
            "bestaudio/best",
            "--extractor-args",
            "youtube:player_client=android,web",
            "--retries",
            "3",
            "--fragment-retries",
            "3",
            "--socket-timeout",
            "15",
            "--output",
            outputTemplate,
            "--print",
            "after_move:%(filepath)s",
        ], url),
        [
            url,
            "--no-playlist",
            "--no-progress",
            "--no-simulate",
            "--force-ipv4",
            "-f",
            "bestaudio/best",
            "--retries",
            "3",
            "--fragment-retries",
            "3",
            "--socket-timeout",
            "15",
            "--output",
            outputTemplate,
            "--print",
            "after_move:%(filepath)s",
        ],
    ];

    if (!isYoutubeUrl(url)) {
        return [variants[1]];
    }

    return variants;
}

function runYtDlpDownload(binary, args) {
    return new Promise((resolve, reject) => {
        const runtime = prepareCookiesArgs(args);
        const child = spawn(binary, runtime.args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        child.on("error", (error) => {
            runtime.cleanup();
            const wrapped = new Error("YTDLP_DOWNLOAD_FAILED");
            wrapped.cause = error;
            reject(wrapped);
        });

        child.on("close", (code) => {
            runtime.cleanup();
            if (code !== 0) {
                const wrapped = new Error("YTDLP_DOWNLOAD_FAILED");
                const details = [stderr.trim(), stdout.trim()]
                    .filter(Boolean)
                    .join("\n")
                    .trim();
                wrapped.cause = new Error(details || `exit_${code}`);
                reject(wrapped);
                return;
            }

            const lines = stdout
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
            const filePath = lines[lines.length - 1] || null;
            if (!filePath) {
                const wrapped = new Error("YTDLP_DOWNLOAD_FAILED");
                wrapped.cause = new Error(stdout.trim() || stderr.trim() || "missing_output_path");
                reject(wrapped);
                return;
            }

            resolve(filePath);
        });
    });
}

function shouldRefreshBinaryOnError(error) {
    if (binaryRefreshAttempted) return false;
    const message = String(error?.cause?.message || error?.message || "");
    return /signature solving failed|challenge solving failed|downloaded file is empty|requested format is not available/i.test(message);
}

async function downloadAudioToFile(url, outputTemplate) {
    if (!url || !outputTemplate) {
        throw new Error("YTDLP_DOWNLOAD_INVALID_ARGS");
    }

    const binary = await ensureBinary();
    const variants = buildDownloadArgVariants(url, outputTemplate);
    let lastError = null;

    for (const args of variants) {
        try {
            return await runYtDlpDownload(binary, args);
        } catch (error) {
            lastError = error;
        }
    }

    if (shouldRefreshBinaryOnError(lastError)) {
        await refreshBinary();
        const refreshedBinary = await ensureBinary();
        for (const args of variants) {
            try {
                return await runYtDlpDownload(refreshedBinary, args);
            } catch (error) {
                lastError = error;
            }
        }
    }

    throw lastError || new Error("YTDLP_DOWNLOAD_FAILED");
}

module.exports = {
    downloadAudioToFile,
    ensureBinary,
    getInfoWithYtDlp,
    searchWithYtDlp,
    streamWithYtDlp,
};
