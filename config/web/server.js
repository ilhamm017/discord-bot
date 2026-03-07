const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { connectDB } = require("../../storage/sequelize");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const CONFIG_PATH = path.join(ROOT_DIR, "config.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(ROOT_DIR, ".data");
const CONFIG_BACKUP_DIR = process.env.CONFIG_BACKUP_DIR
    ? path.resolve(ROOT_DIR, process.env.CONFIG_BACKUP_DIR)
    : ROOT_DIR;
const COOKIE_UPLOAD_PATH = path.join(DATA_DIR, "cookies.txt");
const {
    readManagedLavalinkConfig,
    writeManagedLavalinkConfig,
} = require("./lavalink_config");
const { getElevenLabsUsage } = require("../../storage/db");
const {
    isLavalinkReachable,
    restartLavalinkProcess,
} = require("./lavalink_control");

const HOST = process.env.CONFIG_WEB_HOST || "127.0.0.1";
const PORT = Number(process.env.CONFIG_WEB_PORT || 3210);
const ACCESS_TOKEN = process.env.CONFIG_WEB_TOKEN || "";
const MAX_BODY_BYTES = 1024 * 1024;

const JSON_HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
};

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertSafeObject(value, pathStack = []) {
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
            assertSafeObject(value[i], pathStack.concat(`[${i}]`));
        }
        return;
    }

    if (!isPlainObject(value)) return;

    for (const key of Object.keys(value)) {
        if (key === "__proto__" || key === "prototype" || key === "constructor") {
            throw new Error(`Unsafe key detected at ${pathStack.join(".") || "<root>"}`);
        }
        assertSafeObject(value[key], pathStack.concat(key));
    }
}

function readConfig() {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function writeConfig(nextConfig) {
    assertSafeObject(nextConfig);

    const backupName = `config.backup.${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    fs.mkdirSync(CONFIG_BACKUP_DIR, { recursive: true });
    const backupPath = path.join(CONFIG_BACKUP_DIR, backupName);
    fs.copyFileSync(CONFIG_PATH, backupPath);

    const payload = `${JSON.stringify(nextConfig, null, 2)}\n`;
    fs.writeFileSync(CONFIG_PATH, payload, "utf8");
    return backupName;
}

function ensureDataDir() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getConfiguredCookiesPath(config) {
    if (!isPlainObject(config)) return "";
    const value = config.ytdlp_cookies_path || config.ytdlpCookiesPath || "";
    return typeof value === "string" ? value.trim() : "";
}

function getCookiesStatus(config = readConfig()) {
    const configuredPath = getConfiguredCookiesPath(config);
    const effectivePath = configuredPath
        ? path.resolve(ROOT_DIR, configuredPath)
        : COOKIE_UPLOAD_PATH;
    const exists = fs.existsSync(effectivePath);
    const info = {
        configuredPath,
        effectivePath,
        exists,
        size: 0,
        updatedAt: null,
    };

    if (!exists) return info;

    const stat = fs.statSync(effectivePath);
    info.size = stat.size;
    info.updatedAt = stat.mtime.toISOString();
    return info;
}

function writeUploadedCookies(content) {
    ensureDataDir();
    fs.writeFileSync(COOKIE_UPLOAD_PATH, content, "utf8");
}

function getUsageMonthKey(date = new Date()) {
    return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, "0"),
    ].join("-");
}

async function getElevenLabsUsageStatus(config = readConfig()) {
    const usageMonth = getUsageMonthKey();
    const usage = await getElevenLabsUsage(usageMonth);
    const monthlyLimit = Number.isFinite(Number(config.elevenlabs_monthly_char_limit))
        ? Math.max(0, Number(config.elevenlabs_monthly_char_limit))
        : 9500;
    const monthlyReserve = Number.isFinite(Number(config.elevenlabs_monthly_char_reserve))
        ? Math.max(0, Number(config.elevenlabs_monthly_char_reserve))
        : 1500;
    const usedChars = Math.max(0, Number(usage?.characterCount) || 0);
    const requestCount = Math.max(0, Number(usage?.requestCount) || 0);
    const remaining = Math.max(0, monthlyLimit - usedChars);
    const safeRemaining = Math.max(0, remaining - monthlyReserve);

    return {
        usageMonth,
        characterCount: usedChars,
        requestCount,
        lastUsedAt: usage?.lastUsedAt || null,
        monthlyLimit,
        monthlyReserve,
        remaining,
        safeRemaining,
    };
}

function sendJson(res, status, data) {
    res.writeHead(status, JSON_HEADERS);
    res.end(JSON.stringify(data));
}

function sendFile(res, filePath, contentType) {
    fs.readFile(filePath, (error, content) => {
        if (error) {
            sendJson(res, 500, { ok: false, error: "Failed to read static file." });
            return;
        }
        res.writeHead(200, { "Content-Type": `${contentType}; charset=utf-8` });
        res.end(content);
    });
}

function getTokenFromHeaders(req) {
    const raw = req.headers["x-config-token"];
    return typeof raw === "string" ? raw.trim() : "";
}

function isAuthorized(req) {
    if (!ACCESS_TOKEN) return true;
    return getTokenFromHeaders(req) === ACCESS_TOKEN;
}

function collectBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        let size = 0;

        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error("Request body too large."));
                req.destroy();
                return;
            }
            body += chunk.toString("utf8");
        });

        req.on("end", () => resolve(body));
        req.on("error", reject);
    });
}

function routeStatic(req, res, pathname) {
    if (req.method !== "GET") return false;

    if (pathname === "/" || pathname === "/index.html") {
        sendFile(res, path.join(PUBLIC_DIR, "index.html"), "text/html");
        return true;
    }

    if (pathname === "/app.js") {
        sendFile(res, path.join(PUBLIC_DIR, "app.js"), "text/javascript");
        return true;
    }

    if (pathname === "/styles.css") {
        sendFile(res, path.join(PUBLIC_DIR, "styles.css"), "text/css");
        return true;
    }

    return false;
}

const server = http.createServer(async (req, res) => {
    try {
        const method = req.method || "GET";
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        const { pathname } = url;

        if (method === "GET" && pathname === "/api/health") {
            sendJson(res, 200, {
                ok: true,
                host: HOST,
                port: PORT,
                protected: Boolean(ACCESS_TOKEN),
            });
            return;
        }

        if (method === "GET" && pathname === "/api/config") {
            if (!isAuthorized(req)) {
                sendJson(res, 401, { ok: false, error: "Unauthorized (invalid token)." });
                return;
            }

            const config = readConfig();
            const stat = fs.statSync(CONFIG_PATH);
            sendJson(res, 200, {
                ok: true,
                config,
                meta: {
                    updatedAt: stat.mtime.toISOString(),
                    protected: Boolean(ACCESS_TOKEN),
                },
            });
            return;
        }

        if (method === "GET" && pathname === "/api/ytdlp-cookies") {
            if (!isAuthorized(req)) {
                sendJson(res, 401, { ok: false, error: "Unauthorized (invalid token)." });
                return;
            }

            const config = readConfig();
            sendJson(res, 200, {
                ok: true,
                cookies: getCookiesStatus(config),
            });
            return;
        }

        if (method === "GET" && pathname === "/api/elevenlabs-usage") {
            if (!isAuthorized(req)) {
                sendJson(res, 401, { ok: false, error: "Unauthorized (invalid token)." });
                return;
            }

            const config = readConfig();
            sendJson(res, 200, {
                ok: true,
                usage: await getElevenLabsUsageStatus(config),
            });
            return;
        }

        if (method === "GET" && pathname === "/api/lavalink-config") {
            if (!isAuthorized(req)) {
                sendJson(res, 401, { ok: false, error: "Unauthorized (invalid token)." });
                return;
            }

            const payload = readManagedLavalinkConfig();
            sendJson(res, 200, {
                ok: true,
                config: payload.config,
                notes: payload.notes,
                meta: {
                    ...payload.meta,
                    running: await isLavalinkReachable(),
                },
            });
            return;
        }

        if (method === "POST" && pathname === "/api/config") {
            if (!isAuthorized(req)) {
                sendJson(res, 401, { ok: false, error: "Unauthorized (invalid token)." });
                return;
            }

            const rawBody = await collectBody(req);
            const parsed = rawBody ? JSON.parse(rawBody) : {};

            if (!isPlainObject(parsed) || !isPlainObject(parsed.config)) {
                sendJson(res, 400, { ok: false, error: "Invalid payload. Expected { config: {...} }" });
                return;
            }

            const backupName = writeConfig(parsed.config);
            sendJson(res, 200, {
                ok: true,
                message: "config.json berhasil disimpan.",
                backup: backupName,
            });
            return;
        }

        if (method === "POST" && pathname === "/api/ytdlp-cookies") {
            if (!isAuthorized(req)) {
                sendJson(res, 401, { ok: false, error: "Unauthorized (invalid token)." });
                return;
            }

            const rawBody = await collectBody(req);
            const parsed = rawBody ? JSON.parse(rawBody) : {};
            const filename =
                typeof parsed.filename === "string" ? parsed.filename.trim() : "";
            const content =
                typeof parsed.content === "string" ? parsed.content : "";

            if (!filename.toLowerCase().endsWith(".txt")) {
                sendJson(res, 400, { ok: false, error: "File harus berformat .txt" });
                return;
            }

            if (!content.trim()) {
                sendJson(res, 400, { ok: false, error: "Isi cookies.txt tidak boleh kosong." });
                return;
            }

            writeUploadedCookies(content);

            const nextConfig = readConfig();
            let backupName = null;
            if (nextConfig.ytdlp_cookies_path !== ".data/cookies.txt") {
                nextConfig.ytdlp_cookies_path = ".data/cookies.txt";
                backupName = writeConfig(nextConfig);
            }

            sendJson(res, 200, {
                ok: true,
                message: "cookies.txt berhasil diupload dan diaktifkan.",
                backup: backupName,
                cookies: getCookiesStatus(nextConfig),
            });
            return;
        }

        if (method === "POST" && pathname === "/api/lavalink-config") {
            if (!isAuthorized(req)) {
                sendJson(res, 401, { ok: false, error: "Unauthorized (invalid token)." });
                return;
            }

            const rawBody = await collectBody(req);
            const parsed = rawBody ? JSON.parse(rawBody) : {};
            if (!isPlainObject(parsed) || !isPlainObject(parsed.config)) {
                sendJson(res, 400, { ok: false, error: "Invalid payload. Expected { config: {...} }" });
                return;
            }

            const backupName = writeManagedLavalinkConfig(parsed.config);
            sendJson(res, 200, {
                ok: true,
                message: "lavalink/application.yml berhasil disimpan.",
                backup: backupName,
            });
            return;
        }

        if (method === "POST" && pathname === "/api/lavalink-restart") {
            if (!isAuthorized(req)) {
                sendJson(res, 401, { ok: false, error: "Unauthorized (invalid token)." });
                return;
            }

            const result = await restartLavalinkProcess();
            sendJson(res, 200, {
                ok: true,
                message: "Lavalink berhasil direstart.",
                result,
            });
            return;
        }

        if (routeStatic(req, res, pathname)) return;

        sendJson(res, 404, { ok: false, error: "Not found." });
    } catch (error) {
        sendJson(res, 500, { ok: false, error: error.message || "Internal server error." });
    }
});

async function startServer() {
    await connectDB();
    server.listen(PORT, HOST, () => {
        console.log(`[config-web] running on http://${HOST}:${PORT}`);
        if (!ACCESS_TOKEN) {
            console.log("[config-web] token auth: OFF (localhost-only by default)");
        } else {
            console.log("[config-web] token auth: ON (use header x-config-token)");
        }
    });
}

startServer().catch((error) => {
    console.error("[config-web] failed to start:", error);
    process.exitCode = 1;
});
