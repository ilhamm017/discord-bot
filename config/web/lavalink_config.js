"use strict";

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const LAVALINK_CONFIG_PATH = path.join(ROOT_DIR, "lavalink", "application.yml");

const MANAGED_LAVALINK_FIELDS = [
    {
        key: "server.password",
        yamlPath: "lavalink.server.password",
        note: "Password Lavalink yang dipakai client bot saat konek ke node.",
    },
    {
        key: "sources.youtube",
        yamlPath: "lavalink.server.sources.youtube",
        note: "Aktifkan source YouTube bawaan Lavalink. Pada repo ini biasanya dimatikan karena pakai plugin YouTube terpisah.",
    },
    {
        key: "sources.bandcamp",
        yamlPath: "lavalink.server.sources.bandcamp",
        note: "Aktif/nonaktif source Bandcamp.",
    },
    {
        key: "sources.soundcloud",
        yamlPath: "lavalink.server.sources.soundcloud",
        note: "Aktif/nonaktif source SoundCloud.",
    },
    {
        key: "sources.twitch",
        yamlPath: "lavalink.server.sources.twitch",
        note: "Aktif/nonaktif source Twitch.",
    },
    {
        key: "sources.vimeo",
        yamlPath: "lavalink.server.sources.vimeo",
        note: "Aktif/nonaktif source Vimeo.",
    },
    {
        key: "sources.mixer",
        yamlPath: "lavalink.server.sources.mixer",
        note: "Aktif/nonaktif source Mixer.",
    },
    {
        key: "sources.http",
        yamlPath: "lavalink.server.sources.http",
        note: "Harus aktif kalau ingin putar URL HTTP langsung, termasuk cache audio lokal Yova.",
    },
    {
        key: "sources.local",
        yamlPath: "lavalink.server.sources.local",
        note: "Aktif/nonaktif source file lokal Lavalink.",
    },
    {
        key: "audio.bufferDurationMs",
        yamlPath: "lavalink.server.bufferDurationMs",
        note: "Buffer jitter untuk playback. Lebih besar biasanya lebih tahan putus, tapi menambah latency.",
    },
    {
        key: "audio.frameBufferDurationMs",
        yamlPath: "lavalink.server.frameBufferDurationMs",
        note: "Buffer frame decoded untuk menyerap spike jaringan/CPU.",
    },
    {
        key: "audio.opusEncodingQuality",
        yamlPath: "lavalink.server.opusEncodingQuality",
        note: "Kualitas encoder Opus. Range umum 0-10, makin tinggi makin bagus tapi lebih berat.",
    },
    {
        key: "audio.resamplingQuality",
        yamlPath: "lavalink.server.resamplingQuality",
        note: "Kualitas resampling audio. Nilai umum: LOW, MEDIUM, HIGH.",
    },
    {
        key: "audio.trackStuckThresholdMs",
        yamlPath: "lavalink.server.trackStuckThresholdMs",
        note: "Batas waktu sebelum track dianggap stuck.",
    },
    {
        key: "audio.useSeekGhosting",
        yamlPath: "lavalink.server.useSeekGhosting",
        note: "Membantu mencegah artefak saat seek/crossfade internal.",
    },
    {
        key: "audio.youtubePlaylistLoadLimit",
        yamlPath: "lavalink.server.youtubePlaylistLoadLimit",
        note: "Batas halaman playlist YouTube yang dimuat Lavalink.",
    },
    {
        key: "audio.playerUpdateInterval",
        yamlPath: "lavalink.server.playerUpdateInterval",
        note: "Interval update player ke client dalam detik.",
    },
    {
        key: "search.youtubeSearchEnabled",
        yamlPath: "lavalink.server.youtubeSearchEnabled",
        note: "Aktif/nonaktif pencarian YouTube dari sisi Lavalink.",
    },
    {
        key: "search.soundcloudSearchEnabled",
        yamlPath: "lavalink.server.soundcloudSearchEnabled",
        note: "Aktif/nonaktif pencarian SoundCloud dari sisi Lavalink.",
    },
    {
        key: "runtime.gcWarnings",
        yamlPath: "lavalink.server.gc-warnings",
        note: "Tampilkan warning GC dari Lavalink.",
    },
    {
        key: "plugin.youtube.enabled",
        yamlPath: "youtube.enabled",
        note: "Aktif/nonaktif blok konfigurasi plugin YouTube.",
    },
];

const MANAGED_FIELD_MAP = new Map(
    MANAGED_LAVALINK_FIELDS.map((field) => [field.key, field])
);

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseYamlScalar(raw) {
    const value = String(raw || "").trim();
    if (!value) return "";
    if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
    if (value.startsWith('"') && value.endsWith('"')) {
        try {
            return JSON.parse(value);
        } catch (error) {
            return value.slice(1, -1);
        }
    }
    if (value.startsWith("'") && value.endsWith("'")) {
        return value.slice(1, -1).replace(/''/g, "'");
    }
    return value;
}

function formatYamlScalar(value) {
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (value == null) return '""';
    return JSON.stringify(String(value));
}

function parseYamlPathMap(yamlText) {
    const map = new Map();
    const lines = String(yamlText || "").split(/\r?\n/);
    const stack = [];

    for (const line of lines) {
        if (!line.trim() || /^\s*#/.test(line)) continue;

        const match = /^(\s*)([A-Za-z0-9_-]+):(.*)$/.exec(line);
        if (!match) continue;

        const indent = match[1].length;
        const level = Math.floor(indent / 2);
        const key = match[2];
        const rest = match[3] || "";

        stack.length = level;
        stack[level] = key;

        const valuePart = rest.replace(/\s+#.*$/, "").trim();
        if (!valuePart) continue;

        const yamlPath = stack.slice(0, level + 1).join(".");
        map.set(yamlPath, parseYamlScalar(valuePart));
    }

    return map;
}

function readManagedLavalinkConfig() {
    const yamlText = fs.readFileSync(LAVALINK_CONFIG_PATH, "utf8");
    const pathMap = parseYamlPathMap(yamlText);
    const config = {};
    const notes = {};

    for (const field of MANAGED_LAVALINK_FIELDS) {
        config[field.key] = pathMap.get(field.yamlPath);
        notes[field.key] = field.note;
    }

    const stat = fs.statSync(LAVALINK_CONFIG_PATH);
    return {
        config,
        notes,
        meta: {
            updatedAt: stat.mtime.toISOString(),
            path: LAVALINK_CONFIG_PATH,
        },
    };
}

function updateManagedLavalinkYaml(yamlText, nextConfig) {
    if (!isPlainObject(nextConfig)) {
        throw new Error("Invalid Lavalink payload.");
    }

    const updates = new Map();
    for (const [key, value] of Object.entries(nextConfig)) {
        const field = MANAGED_FIELD_MAP.get(key);
        if (!field) continue;
        updates.set(field.yamlPath, value);
    }

    const lines = String(yamlText || "").split(/\r?\n/);
    const stack = [];
    const found = new Set();

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const match = /^(\s*)([A-Za-z0-9_-]+):(.*)$/.exec(line);
        if (!match) continue;

        const indentText = match[1];
        const indent = indentText.length;
        const level = Math.floor(indent / 2);
        const key = match[2];
        const rest = match[3] || "";

        stack.length = level;
        stack[level] = key;
        const yamlPath = stack.slice(0, level + 1).join(".");

        if (!updates.has(yamlPath)) continue;

        const commentMatch = rest.match(/(\s+#.*)$/);
        const comment = commentMatch ? commentMatch[1] : "";
        lines[i] = `${indentText}${key}: ${formatYamlScalar(updates.get(yamlPath))}${comment}`;
        found.add(yamlPath);
    }

    const missing = [...updates.keys()].filter((yamlPath) => !found.has(yamlPath));
    if (missing.length > 0) {
        throw new Error(`Field Lavalink tidak ditemukan di YAML: ${missing.join(", ")}`);
    }

    return lines.join("\n");
}

function writeManagedLavalinkConfig(nextConfig) {
    const currentYaml = fs.readFileSync(LAVALINK_CONFIG_PATH, "utf8");
    const updatedYaml = updateManagedLavalinkYaml(currentYaml, nextConfig);

    const backupName = `application.backup.${new Date().toISOString().replace(/[:.]/g, "-")}.yml`;
    const backupPath = path.join(path.dirname(LAVALINK_CONFIG_PATH), backupName);
    fs.copyFileSync(LAVALINK_CONFIG_PATH, backupPath);
    fs.writeFileSync(LAVALINK_CONFIG_PATH, updatedYaml, "utf8");

    return backupName;
}

module.exports = {
    LAVALINK_CONFIG_PATH,
    MANAGED_LAVALINK_FIELDS,
    parseYamlPathMap,
    readManagedLavalinkConfig,
    updateManagedLavalinkYaml,
    writeManagedLavalinkConfig,
};
