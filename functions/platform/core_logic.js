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
async function searchWeb(query, maxResults = 5, safeSearch = true) {
    try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

        // Use native Node.js fetch (Node 18+)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
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
            if (results.length >= maxResults) break;

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
            kind: "spotify_mapping_failed",
            severity: "medium",
            match: /Spotify resolver|play-dl search failed for Spotify resolver|Gagal memetakan Spotify/i,
            summary: "Pemetaan lagu Spotify ke YouTube gagal.",
            probableCause: "Resolver Spotify tidak menemukan kandidat YouTube yang valid atau fallback parser gagal.",
            suggestedAction: "Coba query yang lebih spesifik atau periksa cookies/resolver YouTube.",
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

async function getRecentRuntimeIssues(limit = 60, includeLavalink = true) {
    try {
        const perFileLimit = Math.max(20, Math.min(Number(limit) || 60, 200));
        const files = getRuntimeDiagnosticLogFiles(includeLavalink);
        const issuesByKind = new Map();
        const recentErrorLines = [];
        const scannedFiles = [];

        for (const filePath of files) {
            const lines = readLastLines(filePath, perFileLimit);
            if (lines.length === 0) continue;

            scannedFiles.push(filePath);

            for (const line of lines) {
                if (/\b(error|warn|failed|exception|traceback|loadType=error|track stuck|drift)\b/i.test(line)) {
                    recentErrorLines.push({
                        file: filePath,
                        line: line.trim(),
                    });
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
                });
            }
        }

        const issues = Array.from(issuesByKind.values()).sort((a, b) => {
            const severityRank = { high: 3, medium: 2, low: 1 };
            return (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0) || b.count - a.count;
        });

        return {
            status: issues.length > 0 ? "issues_detected" : "no_recent_issue_detected",
            scannedFiles,
            issues,
            recentErrorLines: recentErrorLines.slice(-20),
            summary: issues.length > 0
                ? issues.slice(0, 3).map((item) => item.summary)
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
