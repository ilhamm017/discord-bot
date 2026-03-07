const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const logger = require("../logger");
const {
    ensureAudioCacheDir,
    findCachedFilePath,
    getAudioCacheHost,
    getAudioCachePort,
    isValidVideoId,
} = require("./media_cache");

let server = null;

function getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case ".webm":
            return "audio/webm";
        case ".m4a":
        case ".mp4":
            return "audio/mp4";
        case ".opus":
        case ".ogg":
            return "audio/ogg";
        case ".mp3":
            return "audio/mpeg";
        case ".aac":
            return "audio/aac";
        default:
            return "application/octet-stream";
    }
}

function parseRange(rangeHeader, size) {
    if (!rangeHeader || typeof rangeHeader !== "string") return null;
    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!match) return null;

    let start = match[1] ? Number(match[1]) : null;
    let end = match[2] ? Number(match[2]) : null;

    if (start === null && end === null) return null;
    if (start !== null && (!Number.isInteger(start) || start < 0)) return null;
    if (end !== null && (!Number.isInteger(end) || end < 0)) return null;

    if (start === null) {
        start = Math.max(0, size - end);
        end = size - 1;
    } else if (end === null || end >= size) {
        end = size - 1;
    }

    if (start > end || start >= size) return null;
    return { start, end };
}

function sendNotFound(res) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
}

function handleAudioCacheRequest(req, res, videoId) {
    if (!isValidVideoId(videoId)) {
        sendNotFound(res);
        return;
    }

    const filePath = findCachedFilePath(videoId);
    if (!filePath) {
        sendNotFound(res);
        return;
    }

    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch (error) {
        sendNotFound(res);
        return;
    }

    const contentType = getContentType(filePath);
    const range = parseRange(req.headers.range, stat.size);
    const headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": contentType,
    };

    if (range) {
        headers["Content-Length"] = String(range.end - range.start + 1);
        headers["Content-Range"] = `bytes ${range.start}-${range.end}/${stat.size}`;
        res.writeHead(206, headers);
        if (req.method === "HEAD") {
            res.end();
            return;
        }
        fs.createReadStream(filePath, range).pipe(res);
        return;
    }

    headers["Content-Length"] = String(stat.size);
    res.writeHead(200, headers);
    if (req.method === "HEAD") {
        res.end();
        return;
    }
    fs.createReadStream(filePath).pipe(res);
}

function startMediaCacheServer() {
    if (server) return server;

    ensureAudioCacheDir();
    const host = getAudioCacheHost();
    const port = getAudioCachePort();

    server = http.createServer((req, res) => {
        try {
            const method = req.method || "GET";
            const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
            const pathname = url.pathname || "/";

            if (method !== "GET" && method !== "HEAD") {
                res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
                res.end("method not allowed");
                return;
            }

            if (pathname === "/audio-cache/health") {
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ ok: true, host, port }));
                return;
            }

            if (pathname.startsWith("/audio-cache/")) {
                const videoId = decodeURIComponent(pathname.slice("/audio-cache/".length));
                handleAudioCacheRequest(req, res, videoId);
                return;
            }

            sendNotFound(res);
        } catch (error) {
            logger.warn("Audio cache HTTP server request failed.", error);
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("internal error");
        }
    });

    server.listen(port, host, () => {
        logger.info(`Audio cache HTTP server running at http://${host}:${port}`);
    });

    return server;
}

function stopMediaCacheServer() {
    if (!server) return;
    const current = server;
    server = null;
    current.close();
}

module.exports = {
    startMediaCacheServer,
    stopMediaCacheServer,
};
