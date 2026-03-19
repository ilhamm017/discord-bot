const {
    UserProfile: UserProfileModel,
    UserMemoryKV: UserMemoryKVModel,
    Session: SessionModel,
    Reminder: ReminderModel,
    ToolInvocation: ToolInvocationModel,
    ActionAuditLog: ActionAuditLogModel
} = require("../../models");
const { Op } = require("sequelize");
const logger = require("../../utils/logger");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);

/**
 * E. External info (Read-only)
 */

/**
 * E1. DuckDuckGo search
 * Note: Uses native fetch (Node 18+).
 */
function readRootConfig() {
    const getConfig = require("../../config/index.js");
    return getConfig({ fresh: true });
}

function clampInt(value, min, max, fallback) {
    const num = Number.isFinite(Number(value)) ? Number(value) : fallback;
    const int = Number.isInteger(num) ? num : Math.floor(num);
    return Math.max(min, Math.min(max, int));
}

function normalizeSafeSearch(value) {
    if (value === true) return 1;
    if (value === false) return 0;
    return clampInt(value, 0, 2, 1);
}

const __webSearchCache = new Map(); // key -> { value, expiresAt }
const __WEB_SEARCH_CACHE_TTL_MS = 30_000;

function getCachedWebSearch(key) {
    const item = __webSearchCache.get(key);
    if (!item) return null;
    if (!item.expiresAt || item.expiresAt < Date.now()) {
        __webSearchCache.delete(key);
        return null;
    }
    return item.value;
}

function setCachedWebSearch(key, value, ttlMs = __WEB_SEARCH_CACHE_TTL_MS) {
    __webSearchCache.set(key, { value, expiresAt: Date.now() + Math.max(5_000, ttlMs || __WEB_SEARCH_CACHE_TTL_MS) });
    if (__webSearchCache.size > 200) {
        // best-effort pruning (drop earliest iteration order)
        const overflow = __webSearchCache.size - 200;
        let dropped = 0;
        for (const k of __webSearchCache.keys()) {
            __webSearchCache.delete(k);
            dropped++;
            if (dropped >= overflow) break;
        }
    }
}

async function tryGoogleCseSearch({
    query,
    maxResults,
    safeSearch,
    timeoutMs,
    apiKey,
    cx,
    hl,
    gl,
} = {}) {
    if (!apiKey || !cx) return null;
    const safe = safeSearch === 0 ? "off" : "active";
    const num = clampInt(maxResults, 1, 10, 5);

    const u = new URL("https://www.googleapis.com/customsearch/v1");
    u.searchParams.set("key", String(apiKey));
    u.searchParams.set("cx", String(cx));
    u.searchParams.set("q", String(query || ""));
    u.searchParams.set("safe", safe);
    u.searchParams.set("num", String(num));
    if (hl) u.searchParams.set("hl", String(hl));
    if (gl) u.searchParams.set("gl", String(gl));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(u.toString(), { signal: controller.signal }).finally(() => clearTimeout(timeout));
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Google CSE returned status ${response.status}${text ? `: ${text.slice(0, 120)}` : ""}`);
    }

    const json = await response.json();
    const items = Array.isArray(json?.items) ? json.items : [];
    const results = items
        .map((item) => ({
            title: String(item?.title || "").trim(),
            snippet: String(item?.snippet || "").trim(),
            url: String(item?.link || "").trim(),
        }))
        .filter((r) => r.title || r.url);

    return results.slice(0, num);
}

async function searchWeb(query, maxResults = 5, safeSearch = 1) {
    try {
        const q = String(query || "").trim();
        if (!q) return [];

        const cfg = readRootConfig();
        const safe = normalizeSafeSearch(safeSearch);
        const limit = clampInt(maxResults, 1, 10, 5);
        const timeoutMs = clampInt(cfg.web_search_timeout_ms, 2_000, 25_000, 10_000);

        const provider = String(cfg.web_search_provider || "").trim().toLowerCase();
        const googleApiKey = cfg.google_cse_api_key || process.env.GOOGLE_CSE_API_KEY;
        const googleCx = cfg.google_cse_cx || process.env.GOOGLE_CSE_CX;
        const hl = cfg.web_search_hl || null;
        const gl = cfg.web_search_gl || null;

        const cacheKey = `${provider || "auto"}|q=${q}|n=${limit}|safe=${safe}`;
        const cached = getCachedWebSearch(cacheKey);
        if (cached) return cached;

        // Prefer Google CSE if explicitly configured or keys exist.
        const shouldTryGoogle = provider === "google_cse" || (provider === "auto" || !provider) && (googleApiKey && googleCx);
        if (shouldTryGoogle) {
            try {
                const googleResults = await tryGoogleCseSearch({
                    query: q,
                    maxResults: limit,
                    safeSearch: safe,
                    timeoutMs,
                    apiKey: googleApiKey,
                    cx: googleCx,
                    hl,
                    gl,
                });
                if (Array.isArray(googleResults) && googleResults.length) {
                    setCachedWebSearch(cacheKey, googleResults);
                    return googleResults;
                }
            } catch (error) {
                logger.debug(`Google CSE search failed; falling back. ${error?.message || String(error)}`);
            }
        }

        // DuckDuckGo HTML fallback (no API key)
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;

        // Use native Node.js fetch (Node 18+)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
            headers: {
                "User-Agent": cfg.web_search_user_agent
                    ? String(cfg.web_search_user_agent)
                    : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            },
            signal: controller.signal
        }).finally(() => clearTimeout(timeout));

        if (!response.ok) {
            throw new Error(`DuckDuckGo returned status ${response.status}`);
        }

        const stdout = await response.text();
        const results = [];

        // Regex to match a result block
        // We look for the result__title and the result__snippet
        // Split by result div to strictly separate items
        const rawItems = stdout.split('class="result results_links');

        for (const rawItem of rawItems.slice(1)) { // skip the first split (header)
            if (results.length >= limit) break;

            // Extract Title and URL
            const titleMatch = /<h2 class="result__title">[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(rawItem);
            if (!titleMatch) continue;

            let link = titleMatch[1];
            let title = titleMatch[2].replace(/<[^>]+>/g, '').trim(); // Strip HTML tags

            // Extract Snippet
            const snippetMatch = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(rawItem);
            let snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : "";

            // Basic HTML decoding
            const decode = (str) => str
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#x27;/g, "'")
                .replace(/&#39;/g, "'");

            title = decode(title);
            snippet = decode(snippet);

            // Fix DDG redirect links
            if (link.includes('duckduckgo.com/l/?uddg=')) {
                try {
                    // Often links are like //duckduckgo.com/l/?uddg=...
                    if (link.startsWith('//')) link = 'https:' + link;
                    const u = new URL(link);
                    const uddg = u.searchParams.get('uddg');
                    if (uddg) link = decodeURIComponent(uddg);
                } catch (e) {
                    // keep original link if parsing fails
                }
            }

            results.push({ title, snippet, url: link });
        }

        setCachedWebSearch(cacheKey, results);
        return results;
    } catch (error) {
        logger.error(`Error in searchWeb: ${error.message}`);
        return [];
    }
}

function getRuntimeDiagnosticLogFiles(includeLavalink = true) {
    if (process.env.RUNTIME_DIAGNOSTIC_LOG_FILES) {
        return process.env.RUNTIME_DIAGNOSTIC_LOG_FILES
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
    }

    const cwd = process.cwd();
    const files = [
        path.resolve(cwd, "logs/error.log"),
        path.resolve(cwd, "logs/combined.log"),
        path.resolve(cwd, "logs/combined1.log"),
    ];

    if (includeLavalink) {
        files.push(path.resolve(cwd, "lavalink/lavalink_server.log"));
    }

    return files;
}

function readLastLines(filePath, limit = 80) {
    try {
        if (!fs.existsSync(filePath)) return [];
        const raw = fs.readFileSync(filePath, "utf8");
        return raw
            .split(/\r?\n/)
            .filter((line) => line && line.trim())
            .slice(-Math.max(1, limit));
    } catch (error) {
        logger.debug(`Failed to read runtime diagnostic log file: ${filePath}. ${error.message}`);
        return [];
    }
}

function parseRuntimeLogTimestamp(line) {
    const text = String(line || "").trim();
    if (!text) return null;

    let match = text.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
    if (match?.[1]) {
        const parsed = new Date(match[1].replace(" ", "T"));
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    match = text.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))/);
    if (match?.[1]) {
        const parsed = new Date(match[1]);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    match = text.match(/"timestamp":"([^"]+)"/);
    if (match?.[1]) {
        const parsed = new Date(match[1]);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    return null;
}

function redactSecretsInText(text) {
    let s = String(text || "");
    if (!s) return s;

    const replacements = [
        // Discord tokens (very common shape)
        { re: /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, to: "[REDACTED_DISCORD_TOKEN]" },
        // Google API key prefix
        { re: /\bAIza[0-9A-Za-z\-_]{20,}\b/g, to: "[REDACTED_GOOGLE_KEY]" },
        // Groq key prefix (common)
        { re: /\bgsk_[0-9A-Za-z]{10,}\b/g, to: "[REDACTED_GROQ_KEY]" },
        // Generic "Authorization: Bearer ..."
        { re: /\bAuthorization:\s*Bearer\s+[^\s]+/gi, to: "Authorization: Bearer [REDACTED]" },
        // "x-config-token" header
        { re: /\bx-config-token\b\s*:\s*[^\s]+/gi, to: "x-config-token: [REDACTED]" },
    ];

    for (const { re, to } of replacements) {
        s = s.replace(re, to);
    }
    return s;
}

function redactSecretsDeep(value) {
    if (typeof value === "string") return redactSecretsInText(value);
    if (Array.isArray(value)) return value.map(redactSecretsDeep);
    if (!value || typeof value !== "object") return value;

    const out = {};
    for (const [k, v] of Object.entries(value)) {
        out[k] = redactSecretsDeep(v);
    }
    return out;
}

function parseJsonLine(line) {
    const text = String(line || "").trim();
    if (!text) return null;
    if (!(text.startsWith("{") && text.endsWith("}"))) return null;
    try {
        const obj = JSON.parse(text);
        return obj && typeof obj === "object" ? obj : null;
    } catch {
        return null;
    }
}

function levelRank(level) {
    const l = String(level || "").toLowerCase();
    if (l === "error") return 3;
    if (l === "warn" || l === "warning") return 2;
    if (l === "info") return 1;
    return 0;
}

async function getRecentErrors(limit = 20, includeLavalink = true, options = {}) {
    try {
        const lim = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 80)) : 20;
        const maxChars = Number.isInteger(options.maxChars) ? Math.max(400, Math.min(options.maxChars, 30_000)) : 8000;
        const includeStack = options.includeStack === true;
        const minLevel = String(options.minLevel || "error").toLowerCase();
        const minRank = levelRank(minLevel);

        const scannedFiles = getRuntimeDiagnosticLogFiles(includeLavalink);
        const items = [];

        // Read more lines than limit because we filter by severity
        const perFileRead = Math.max(80, lim * 8);
        for (const filePath of scannedFiles) {
            const lines = readLastLines(filePath, perFileRead);
            for (const line of lines) {
                const timestamp = parseRuntimeLogTimestamp(line);
                const json = parseJsonLine(line);

                if (json) {
                    const lvl = String(json.level || "").toLowerCase();
                    if (levelRank(lvl) < minRank) continue;

                    const safe = redactSecretsDeep(json);
                    const entry = {
                        source: path.basename(filePath),
                        file: filePath,
                        timestamp: safe.timestamp || (timestamp ? timestamp.toISOString() : null),
                        level: lvl || "error",
                        message: redactSecretsInText(safe.message || ""),
                    };
                    if (includeStack && safe.stack) entry.stack = redactSecretsInText(safe.stack);
                    // include a tiny bit of context when available
                    for (const key of ["code", "name", "url", "title", "model"]) {
                        if (safe[key] != null && entry[key] == null) entry[key] = safe[key];
                    }
                    items.push(entry);
                    continue;
                }

                // plain-text fallback: pick lines that look like errors/warnings
                const lower = String(line).toLowerCase();
                const inferredLevel =
                    lower.includes("error") || lower.includes("failed") || lower.includes("exception") ? "error"
                        : lower.includes("warn") || lower.includes("warning") ? "warn"
                            : "";
                if (!inferredLevel || levelRank(inferredLevel) < minRank) continue;

                items.push({
                    source: path.basename(filePath),
                    file: filePath,
                    timestamp: timestamp ? timestamp.toISOString() : null,
                    level: inferredLevel,
                    message: redactSecretsInText(String(line).trim()),
                });
            }
        }

        items.sort((a, b) => {
            const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return tb - ta;
        });

        // Trim by total chars
        const out = [];
        let remaining = maxChars;
        for (const item of items) {
            const compact = JSON.stringify(item);
            if (compact.length + 2 > remaining) break;
            out.push(item);
            remaining -= (compact.length + 2);
            if (out.length >= lim) break;
        }

        return {
            status: out.length ? "ok" : "no_recent_error_detected",
            scannedFiles,
            items: out,
        };
    } catch (error) {
        logger.error(`Error in getRecentErrors: ${error.message}`);
        return {
            status: "failed",
            error: error.message,
            scannedFiles: [],
            items: [],
        };
    }
}

function getRuntimeDiagnosticsReferenceNow() {
    const override = process.env.RUNTIME_DIAGNOSTIC_NOW;
    if (override) {
        const parsed = new Date(override);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }

    return new Date();
}

function classifyRuntimeIssue(line) {
    const text = String(line || "");

    const patterns = [
        {
            kind: "youtube_cookies_invalid",
            severity: "high",
            match: /cookies are no longer valid|cookies.*(?:expired|invalid|rotated)|sign in to confirm you.?re not a bot/i,
            summary: "Cookies YouTube bermasalah atau sudah tidak valid.",
            probableCause: "yt-dlp ditolak YouTube karena cookies login sudah expired, ter-rotate, atau tidak cocok.",
            suggestedAction: "Upload ulang cookies YouTube yang fresh dari browser yang masih login, lalu restart bot/container.",
        },
        {
            kind: "youtube_download_failed",
            severity: "high",
            match: /YTDLP_(?:DOWNLOAD|SEARCH)_FAILED|yt-dlp search failed|Audio cache download failed/i,
            summary: "Pengambilan audio atau pencarian YouTube gagal.",
            probableCause: "yt-dlp gagal mencari atau mengunduh source YouTube.",
            suggestedAction: "Cek cookies YouTube, query pencarian, dan error yt-dlp terbaru.",
        },
        {
            kind: "lavalink_no_tracks",
            severity: "high",
            match: /No tracks found via Lavalink|loadType=error, tracks=0/i,
            summary: "Lavalink tidak menemukan track untuk diputar.",
            probableCause: "Source playback tidak valid, cache lokal gagal dibangun, atau resolver remote ditolak.",
            suggestedAction: "Periksa source query, status cache lokal, dan error YouTube/Lavalink sebelum baris ini.",
        },
        {
            kind: "voice_drift",
            severity: "medium",
            match: /position drift exceeded|track stuck|buffer underrun/i,
            summary: "Ada indikasi drift atau macet pada playback voice.",
            probableCause: "Jitter koneksi voice, underrun buffer, atau pause singkat di runtime Lavalink.",
            suggestedAction: "Cek kestabilan koneksi voice Discord dan log Lavalink saat stutter terjadi.",
        },
        {
            kind: "watchdog_recovery_loop",
            severity: "medium",
            match: /Watchdog auto-(?:advancing|repeating)|watchdog failed/i,
            summary: "Watchdog player sedang mencoba recovery atau mengulang track.",
            probableCause: "Player dianggap idle/tidak sinkron sehingga watchdog memaksa play ulang atau next.",
            suggestedAction: "Cek repeat mode, status queue, dan error playback tepat sebelum watchdog aktif.",
        },
        {
            kind: "database_locked",
            severity: "medium",
            match: /SQLITE_BUSY|database is locked/i,
            summary: "Database SQLite sedang terkunci.",
            probableCause: "Ada kontensi akses database atau transaksi belum selesai saat operasi baru masuk.",
            suggestedAction: "Kurangi konkurensi penulisan atau periksa operasi DB yang berjalan bersamaan.",
        },
    ];

    for (const pattern of patterns) {
        if (pattern.match.test(text)) {
            return {
                kind: pattern.kind,
                severity: pattern.severity,
                summary: pattern.summary,
                probableCause: pattern.probableCause,
                suggestedAction: pattern.suggestedAction,
            };
        }
    }

    return null;
}

function classifyRuntimeRecovery(line) {
    const text = String(line || "");

    if (/Audio cache ready for (?:YouTube )?track|Audio cache hit for YouTube track/i.test(text)) {
        return { kind: "youtube_cache_ready" };
    }

    if (/Resolved playback source.*"mode":"local-cache"|Resolved playback source.*mode["']?\s*:\s*["']local-cache["']/i.test(text)) {
        return { kind: "youtube_local_cache_playback" };
    }

    if (/Lavalink playing:/i.test(text)) {
        return { kind: "playback_started" };
    }

    return null;
}

async function getRecentRuntimeIssues(limit = 60, includeLavalink = true) {
    try {
        const perFileLimit = Math.max(20, Math.min(Number(limit) || 60, 200));
        const maxAgeMs = Number(process.env.RUNTIME_DIAGNOSTIC_MAX_AGE_MS) > 0
            ? Number(process.env.RUNTIME_DIAGNOSTIC_MAX_AGE_MS)
            : 15 * 60 * 1000;
        const referenceNow = getRuntimeDiagnosticsReferenceNow();
        const files = getRuntimeDiagnosticLogFiles(includeLavalink);
        const issuesByKind = new Map();
        const recentErrorLines = [];
        const scannedFiles = [];
        let latestYoutubeRecoveryAt = null;

        for (const filePath of files) {
            const lines = readLastLines(filePath, perFileLimit);
            if (lines.length === 0) continue;

            scannedFiles.push(filePath);
            let lastTimestamp = null;

            for (const line of lines) {
                const parsedTimestamp = parseRuntimeLogTimestamp(line);
                if (parsedTimestamp) {
                    lastTimestamp = parsedTimestamp;
                }

                const timestamp = parsedTimestamp || lastTimestamp;
                if (timestamp && referenceNow.getTime() - timestamp.getTime() > maxAgeMs) {
                    continue;
                }

                if (/\b(error|warn|failed|exception|traceback|loadType=error|track stuck|drift)\b/i.test(line)) {
                    recentErrorLines.push({
                        file: filePath,
                        line: line.trim(),
                        timestamp: timestamp ? timestamp.toISOString() : null,
                    });
                }

                const recovery = classifyRuntimeRecovery(line);
                if (recovery && timestamp) {
                    if (
                        !latestYoutubeRecoveryAt ||
                        timestamp.getTime() > latestYoutubeRecoveryAt.getTime()
                    ) {
                        latestYoutubeRecoveryAt = timestamp;
                    }
                }

                const issue = classifyRuntimeIssue(line);
                if (!issue) continue;

                const existing = issuesByKind.get(issue.kind);
                if (existing) {
                    existing.count += 1;
                    existing.lastSeenIn = filePath;
                    existing.evidence = line.trim();
                    continue;
                }

                issuesByKind.set(issue.kind, {
                    ...issue,
                    count: 1,
                    lastSeenIn: filePath,
                    evidence: line.trim(),
                    lastSeenAt: timestamp ? timestamp.toISOString() : null,
                });
            }
        }

        const issues = Array.from(issuesByKind.values()).sort((a, b) => {
            const severityRank = { high: 3, medium: 2, low: 1 };
            return (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0) || b.count - a.count;
        });

        const filteredIssues = issues.filter((issue) => {
            if (!latestYoutubeRecoveryAt) return true;
            if (!["youtube_cookies_invalid", "youtube_download_failed", "lavalink_no_tracks"].includes(issue.kind)) {
                return true;
            }
            if (!issue.lastSeenAt) return true;
            const issueTime = new Date(issue.lastSeenAt);
            if (Number.isNaN(issueTime.getTime())) return true;
            return issueTime.getTime() > latestYoutubeRecoveryAt.getTime();
        });

        return {
            status: filteredIssues.length > 0 ? "issues_detected" : "no_recent_issue_detected",
            scannedFiles,
            issues: filteredIssues,
            recentErrorLines: recentErrorLines.slice(-20),
            summary: filteredIssues.length > 0
                ? filteredIssues.slice(0, 3).map((item) => item.summary)
                : ["Tidak ada pola error runtime yang jelas di log terbaru."],
        };
    } catch (error) {
        logger.error(`Error in getRecentRuntimeIssues: ${error.message}`);
        return {
            status: "diagnostic_failed",
            error: error.message,
            issues: [],
            recentErrorLines: [],
            scannedFiles: [],
        };
    }
}

/**
 * F. User Memory (DB)
 */

/**
 * F1. Get profile
 */
async function getUserProfile(guildId, userId) {
    try {
        const profile = await UserProfileModel.findOne({ where: { guild_id: guildId, user_id: userId } });
        return profile ? { timezone: profile.timezone, language: profile.language, personaPreference: profile.persona_preference } : null;
    } catch (error) {
        logger.error(`Error in getUserProfile: ${error.message}`);
        return null;
    }
}

/**
 * F2. Upsert profile
 */
async function setUserProfile(guildId, userId, timezone = null, language = "id", personaPreference = null) {
    try {
        await UserProfileModel.upsert({
            guild_id: guildId,
            user_id: userId,
            timezone,
            language,
            persona_preference: personaPreference
        });
        return { updated: true };
    } catch (error) {
        logger.error(`Error in setUserProfile: ${error.message}`);
        return { updated: false };
    }
}

/**
 * F3. Get user memory KV
 */
async function getUserMemory(guildId, userId, key = null) {
    try {
        const where = { guild_id: guildId, user_id: userId };
        if (key) where.key = key;

        // Only get non-expired
        where[Op.or] = [
            { expires_at: null },
            { expires_at: { [Op.gt]: new Date() } }
        ];

        const memories = await UserMemoryKVModel.findAll({ where });
        return {
            memories: memories.map(m => ({
                key: m.key,
                valueJson: m.value_json,
                source: m.source,
                confidence: m.confidence,
                expiresAt: m.expires_at
            }))
        };
    } catch (error) {
        logger.error(`Error in getUserMemory: ${error.message}`);
        return { memories: [] };
    }
}

/**
 * F4. Set user memory KV
 */
async function setUserMemory(guildId, userId, key, valueJson, source = 'user', confidence = 1.0, expiresAt = null) {
    try {
        await UserMemoryKVModel.upsert({
            guild_id: guildId,
            user_id: userId,
            key,
            value_json: valueJson,
            source,
            confidence,
            expires_at: expiresAt
        });
        return { saved: true };
    } catch (error) {
        logger.error(`Error in setUserMemory: ${error.message}`);
        return { saved: false };
    }
}

/**
 * F5. Clear user memory
 */
async function clearUserMemory(guildId, userId, key = null) {
    try {
        const where = { guild_id: guildId, user_id: userId };
        if (key) where.key = key;
        const count = await UserMemoryKVModel.destroy({ where });
        return { cleared: true, count };
    } catch (error) {
        logger.error(`Error in clearUserMemory: ${error.message}`);
        return { cleared: false, count: 0 };
    }
}

/**
 * G. Session / Context (Entity tracking)
 */

async function getSession(sessionId) {
    try {
        const session = await SessionModel.findByPk(sessionId);
        if (!session) return null;
        return {
            guildId: session.guild_id,
            channelId: session.channel_id,
            userId: session.user_id,
            lastEntityType: session.last_entity_type,
            lastEntityId: session.last_entity_id,
            stateJson: session.state_json
        };
    } catch (error) {
        logger.error(`Error in getSession: ${error.message}`);
        return null;
    }
}

async function upsertSession(sessionId, guildId, channelId, userId, lastEntityType = null, lastEntityId = null, stateJson = null) {
    try {
        await SessionModel.upsert({
            session_id: sessionId,
            guild_id: guildId,
            channel_id: channelId,
            user_id: userId,
            last_entity_type: lastEntityType,
            last_entity_id: lastEntityId,
            state_json: stateJson
        });
        return { saved: true };
    } catch (error) {
        logger.error(`Error in upsertSession: ${error.message}`);
        return { saved: false };
    }
}

async function setLastEntity(sessionId, entityType, entityId) {
    try {
        const session = await SessionModel.findByPk(sessionId);
        if (session) {
            session.last_entity_type = entityType;
            session.last_entity_id = entityId;
            await session.save();
            return { saved: true };
        }
        return { saved: false };
    } catch (error) {
        logger.error(`Error in setLastEntity: ${error.message}`);
        return { saved: false };
    }
}

/**
 * H. Reminders (DB + scheduler)
 */

async function createReminder(guildId, userId, channelId = null, remindAt, message) {
    try {
        const id = Math.random().toString(36).substring(2, 11);
        await ReminderModel.create({
            reminder_id: id,
            guild_id: guildId,
            user_id: userId,
            channel_id: channelId,
            message,
            remind_at: new Date(remindAt),
            status: 'scheduled'
        });
        return { reminderId: id };
    } catch (error) {
        logger.error(`Error in createReminder: ${error.message}`);
        return null;
    }
}

async function listUserReminders(guildId, userId, status = 'scheduled', limit = 20) {
    try {
        const list = await ReminderModel.findAll({
            where: { guild_id: guildId, user_id: userId, status },
            limit,
            order: [['remind_at', 'ASC']]
        });
        return list.map(r => ({
            reminderId: r.reminder_id,
            remindAt: r.remind_at,
            message: r.message,
            status: r.status
        }));
    } catch (error) {
        logger.error(`Error in listUserReminders: ${error.message}`);
        return [];
    }
}

async function cancelReminder(reminderId, reason = "") {
    try {
        const reminder = await ReminderModel.findByPk(reminderId);
        if (reminder) {
            reminder.status = 'cancelled';
            await reminder.save();
            return { cancelled: true };
        }
        return { cancelled: false };
    } catch (error) {
        logger.error(`Error in cancelReminder: ${error.message}`);
        return { cancelled: false };
    }
}

async function updateReminderStatus(reminderId, status, error = null) {
    try {
        const reminder = await ReminderModel.findByPk(reminderId);
        if (reminder) {
            reminder.status = status;
            await reminder.save();
            return { updated: true };
        }
        return { updated: false };
    } catch (error) {
        logger.error(`Error in updateReminderStatus: ${error.message}`);
        return { updated: false };
    }
}

/**
 * I. Logging & Audit (internal control)
 */

async function logToolInvocation(guildId, channelId, userId, sessionId, toolName, argumentsJson = null, toolResultJson = null, modelName = null, latencyMs = null, tokenIn = null, tokenOut = null) {
    try {
        await ToolInvocationModel.create({
            guild_id: guildId,
            channel_id: channelId,
            user_id: userId,
            session_id: sessionId,
            tool_name: toolName,
            arguments_json: typeof argumentsJson === 'object' ? JSON.stringify(argumentsJson) : argumentsJson,
            tool_result_json: typeof toolResultJson === 'object' ? JSON.stringify(toolResultJson) : toolResultJson,
            model_name: modelName,
            latency_ms: latencyMs,
            token_in: tokenIn,
            token_out: tokenOut
        });
        return { logged: true };
    } catch (error) {
        logger.error(`Error in logToolInvocation: ${error.message}`);
        return { logged: false };
    }
}

async function logActionAudit(guildId, actorUserId, actionType, status, targetUserId = null, targetMessageId = null, targetChannelId = null, requestJson = null, resultJson = null, reason = null) {
    try {
        await ActionAuditLogModel.create({
            guild_id: guildId,
            actor_user_id: actorUserId,
            action_type: actionType,
            status,
            target_user_id: targetUserId,
            target_message_id: targetMessageId,
            channel_id: targetChannelId,
            request_json: typeof requestJson === 'object' ? JSON.stringify(requestJson) : requestJson,
            result_json: typeof resultJson === 'object' ? JSON.stringify(resultJson) : resultJson,
            reason
        });
        return { logged: true };
    } catch (error) {
        logger.error(`Error in logActionAudit: ${error.message}`);
        return { logged: false };
    }
}

module.exports = {
    searchWeb,
    getRecentErrors,
    getRecentRuntimeIssues,
    getUserProfile,
    setUserProfile,
    getUserMemory,
    setUserMemory,
    clearUserMemory,
    getSession,
    upsertSession,
    setLastEntity,
    createReminder,
    listUserReminders,
    cancelReminder,
    updateReminderStatus,
    logToolInvocation,
    logActionAudit
};
