const formEl = document.getElementById("form");
const lavalinkFormEl = document.getElementById("lavalinkForm");
const statusEl = document.getElementById("status");
const lavalinkStatusEl = document.getElementById("lavalinkStatus");
const tabBarEl = document.getElementById("tabBar");
const configBlockEl = document.getElementById("configBlock");
const cookiePanelEl = document.getElementById("cookiePanel");
const lavalinkBlockEl = document.getElementById("lavalinkBlock");
const saveBtn = document.getElementById("saveBtn");
const reloadBtn = document.getElementById("reloadBtn");
const saveLavalinkBtn = document.getElementById("saveLavalinkBtn");
const reloadLavalinkBtn = document.getElementById("reloadLavalinkBtn");
const restartLavalinkBtn = document.getElementById("restartLavalinkBtn");
const tokenInput = document.getElementById("tokenInput");
const cookiesFileInput = document.getElementById("cookiesFileInput");
const uploadCookiesBtn = document.getElementById("uploadCookiesBtn");
const cookiesStatusEl = document.getElementById("cookiesStatus");

const SECRET_KEY_RE = /(token|key|secret|password)/i;
const CONFIG_TABS = [
    { id: "general", label: "Umum" },
    { id: "ai", label: "AI" },
    { id: "voice_ai", label: "Voice AI" },
    { id: "music", label: "Musik" },
    { id: "runtime", label: "Runtime" },
    { id: "integrations", label: "Integrasi" },
    { id: "cookies", label: "Cookies" },
    { id: "lavalink", label: "Lavalink" },
];

let rawConfig = {};
let rawConfigNotes = {};
let rawLavalinkConfig = {};
let rawElevenLabsUsage = null;
let activeTabId = "general";
const fieldRegistry = new Map();
const lavalinkFieldRegistry = new Map();

function setStatus(targetEl, message, kind = "info") {
    targetEl.textContent = message;
    targetEl.classList.remove("ok", "error");
    if (kind === "ok") targetEl.classList.add("ok");
    if (kind === "error") targetEl.classList.add("error");
}

function setMainStatus(message, kind = "info") {
    setStatus(statusEl, message, kind);
}

function setLavalinkStatus(message, kind = "info") {
    setStatus(lavalinkStatusEl, message, kind);
}

function setCookiesStatus(message, kind = "info") {
    setStatus(cookiesStatusEl, message, kind);
}

function isObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
}

function classifyValue(value) {
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "number") return "number";
    if (typeof value === "string") return value.includes("\n") ? "multiline" : "string";
    return "json";
}

function createTextInput(type, value, secret) {
    const input = document.createElement("input");
    input.type = secret ? "password" : type;
    input.value = value == null ? "" : String(value);
    return input;
}

function createValueEditor(key, value) {
    const kind = classifyValue(value);
    let inputEl;

    if (kind === "boolean") {
        const wrap = document.createElement("label");
        wrap.className = "bool-wrap";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = Boolean(value);

        const caption = document.createElement("span");
        caption.textContent = "Aktif";

        wrap.append(checkbox, caption);
        inputEl = checkbox;
        return { kind, element: wrap, inputEl };
    }

    if (kind === "number") {
        inputEl = createTextInput("number", value, false);
        inputEl.step = "any";
        return { kind, element: inputEl, inputEl };
    }

    if (kind === "string" || kind === "multiline") {
        if (kind === "multiline") {
            inputEl = document.createElement("textarea");
            inputEl.value = value == null ? "" : String(value);
        } else {
            const secret = SECRET_KEY_RE.test(key);
            inputEl = createTextInput("text", value, secret);
        }
        return { kind, element: inputEl, inputEl };
    }

    inputEl = document.createElement("textarea");
    inputEl.value = JSON.stringify(value, null, 2);
    return { kind, element: inputEl, inputEl };
}

function classifyConfigTab(key) {
    if (key.startsWith("elevenlabs_") || key.startsWith("ai_voice_reply_")) {
        return "voice_ai";
    }

    if (key.startsWith("google_") || key.startsWith("groq_") || key.startsWith("ai_") || key.startsWith("guild_members_") || key.startsWith("channel_summary_")) {
        return "ai";
    }

    if (key.startsWith("spotify_") || key.startsWith("ytdlp_")) {
        return "integrations";
    }

    if (key.startsWith("log_") || key.startsWith("terminal_")) {
        return "runtime";
    }

    if (key.startsWith("search_") || key === "default_voice_channel") {
        return "music";
    }

    return "general";
}

function buildTabPanels(targetEl) {
    const panels = new Map();
    for (const tab of CONFIG_TABS) {
        if (tab.id === "cookies" || tab.id === "lavalink") continue;
        const panel = document.createElement("div");
        panel.className = "config-tab-panel";
        panel.dataset.tab = tab.id;
        panel.hidden = tab.id !== activeTabId;
        targetEl.append(panel);
        panels.set(tab.id, panel);
    }

    const voiceAiPanel = panels.get("voice_ai");
    if (voiceAiPanel) {
        const summary = document.createElement("section");
        summary.id = "voiceAiSummary";
        summary.className = "voice-ai-summary";
        summary.innerHTML = `
            <div class="voice-ai-summary-head">
                <div>
                    <p class="badge">ELEVENLABS</p>
                    <h3>Kuota Voice AI</h3>
                </div>
            </div>
            <p class="voice-ai-summary-copy">Memuat status pemakaian karakter bulan ini...</p>
        `;
        voiceAiPanel.append(summary);
    }

    return panels;
}

function renderConfigForm(targetEl, registry, config, notes = {}) {
    targetEl.innerHTML = "";
    registry.clear();
    const panels = buildTabPanels(targetEl);

    const keys = Object.keys(config).sort((a, b) => a.localeCompare(b));

    keys.forEach((key) => {
        if (key === "config_notes") return;

        const field = document.createElement("section");
        field.className = "field";

        const head = document.createElement("div");
        head.className = "field-head";

        const keyEl = document.createElement("h3");
        keyEl.className = "field-key";
        keyEl.textContent = key;

        const editor = createValueEditor(key, config[key]);
        const typeEl = document.createElement("span");
        typeEl.className = "field-type";
        typeEl.textContent = editor.kind;

        head.append(keyEl, typeEl);

        const noteEl = document.createElement("p");
        noteEl.className = "field-note";
        noteEl.textContent = notes[key] || "-";

        field.append(head, noteEl, editor.element);
        const tabId = classifyConfigTab(key);
        const panel = panels.get(tabId) || panels.get("general");
        panel.append(field);

        registry.set(key, editor);
    });

    for (const [tabId, panel] of panels.entries()) {
        if (panel.querySelector(".field")) continue;
        const empty = document.createElement("p");
        empty.className = "tab-empty";
        empty.textContent = `Belum ada field konfigurasi untuk tab ${CONFIG_TABS.find((tab) => tab.id === tabId)?.label || tabId}.`;
        panel.append(empty);
    }
}

function renderSimpleForm(targetEl, registry, config, notes = {}) {
    targetEl.innerHTML = "";
    registry.clear();

    const keys = Object.keys(config).sort((a, b) => a.localeCompare(b));

    keys.forEach((key) => {
        const field = document.createElement("section");
        field.className = "field";

        const head = document.createElement("div");
        head.className = "field-head";

        const keyEl = document.createElement("h3");
        keyEl.className = "field-key";
        keyEl.textContent = key;

        const editor = createValueEditor(key, config[key]);
        const typeEl = document.createElement("span");
        typeEl.className = "field-type";
        typeEl.textContent = editor.kind;

        head.append(keyEl, typeEl);

        const noteEl = document.createElement("p");
        noteEl.className = "field-note";
        noteEl.textContent = notes[key] || "-";

        field.append(head, noteEl, editor.element);
        targetEl.append(field);

        registry.set(key, editor);
    });
}

function renderTabBar() {
    tabBarEl.innerHTML = "";
    for (const tab of CONFIG_TABS) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tab-button";
        button.textContent = tab.label;
        button.dataset.tab = tab.id;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", tab.id === activeTabId ? "true" : "false");
        if (tab.id === activeTabId) {
            button.classList.add("active");
        }
        button.addEventListener("click", () => {
            setActiveTab(tab.id);
        });
        tabBarEl.append(button);
    }
}

function updateVisibleSections() {
    const configTabs = new Set(["general", "ai", "voice_ai", "music", "integrations"]);
    configBlockEl.hidden = !configTabs.has(activeTabId);
    cookiePanelEl.hidden = activeTabId !== "cookies";
    lavalinkBlockEl.hidden = activeTabId !== "lavalink";

    const panels = formEl.querySelectorAll(".config-tab-panel");
    panels.forEach((panel) => {
        panel.hidden = panel.dataset.tab !== activeTabId;
    });
}

function setActiveTab(tabId) {
    activeTabId = CONFIG_TABS.some((tab) => tab.id === tabId) ? tabId : "general";
    renderTabBar();
    updateVisibleSections();
}

function readEditorValue(key, editor) {
    if (editor.kind === "boolean") {
        return Boolean(editor.inputEl.checked);
    }

    if (editor.kind === "number") {
        const raw = String(editor.inputEl.value).trim();
        if (raw === "") return 0;
        const num = Number(raw);
        if (Number.isNaN(num)) throw new Error(`Nilai number tidak valid untuk "${key}"`);
        return num;
    }

    if (editor.kind === "string" || editor.kind === "multiline") {
        return String(editor.inputEl.value);
    }

    try {
        return JSON.parse(editor.inputEl.value || "null");
    } catch {
        throw new Error(`JSON tidak valid untuk "${key}"`);
    }
}

function collectFormValues(registry, baseConfig = {}, notes = null) {
    const nextConfig = {};
    if (notes && isObject(baseConfig.config_notes)) {
        nextConfig.config_notes = baseConfig.config_notes;
    }

    for (const [key, editor] of registry.entries()) {
        nextConfig[key] = readEditorValue(key, editor);
    }

    return nextConfig;
}

function getTokenHeader() {
    const token = tokenInput.value.trim();
    if (!token) return {};
    return { "x-config-token": token };
}

function formatCookieStatus(cookies, health) {
    if (!cookies || !cookies.exists) {
        const suffix = health?.summary ? ` | ${health.summary}` : "";
        return `Belum ada file cookies aktif.${suffix}`;
    }

    const parts = [
        `Aktif: ${cookies.effectivePath}`,
        `Ukuran: ${cookies.size} byte`,
    ];
    if (cookies.updatedAt) {
        parts.push(`Update: ${cookies.updatedAt}`);
    }
    if (health?.status) {
        parts.push(`Health: ${health.status}`);
    }
    if (health?.summary) {
        parts.push(health.summary);
    }
    return parts.join(" | ");
}

function formatLavalinkStatus(meta) {
    if (!meta) return "Status Lavalink belum tersedia.";
    const parts = [
        meta.running ? "Node online" : "Node offline",
    ];
    if (meta.updatedAt) {
        parts.push(`YAML update: ${meta.updatedAt}`);
    }
    if (meta.path) {
        parts.push(`File: ${meta.path}`);
    }
    return parts.join(" | ");
}

function formatInt(value) {
    return new Intl.NumberFormat("id-ID").format(Math.max(0, Number(value) || 0));
}

function renderVoiceAiSummary() {
    const summaryEl = document.getElementById("voiceAiSummary");
    if (!summaryEl) return;

    if (!rawElevenLabsUsage) {
        summaryEl.innerHTML = `
            <div class="voice-ai-summary-head">
                <div>
                    <p class="badge">ELEVENLABS</p>
                    <h3>Kuota Voice AI</h3>
                </div>
            </div>
            <p class="voice-ai-summary-copy">Status kuota belum tersedia.</p>
        `;
        return;
    }

    const usageRatio = rawElevenLabsUsage.monthlyLimit > 0
        ? Math.min(100, Math.round((rawElevenLabsUsage.characterCount / rawElevenLabsUsage.monthlyLimit) * 100))
        : 0;
    const lastUsedAt = rawElevenLabsUsage.lastUsedAt
        ? new Date(rawElevenLabsUsage.lastUsedAt).toLocaleString("id-ID")
        : "Belum ada request bulan ini";

    summaryEl.innerHTML = `
        <div class="voice-ai-summary-head">
            <div>
                <p class="badge">ELEVENLABS</p>
                <h3>Kuota Voice AI</h3>
            </div>
            <span class="voice-ai-summary-ratio">${usageRatio}% terpakai</span>
        </div>
        <p class="voice-ai-summary-copy">Status pemakaian karakter bulan <strong>${rawElevenLabsUsage.usageMonth}</strong>.</p>
        <div class="voice-ai-summary-grid">
            <div class="voice-ai-stat">
                <span class="voice-ai-stat-label">Terpakai</span>
                <strong>${formatInt(rawElevenLabsUsage.characterCount)}</strong>
            </div>
            <div class="voice-ai-stat">
                <span class="voice-ai-stat-label">Sisa</span>
                <strong>${formatInt(rawElevenLabsUsage.remaining)}</strong>
            </div>
            <div class="voice-ai-stat">
                <span class="voice-ai-stat-label">Cadangan aman</span>
                <strong>${formatInt(rawElevenLabsUsage.safeRemaining)}</strong>
            </div>
            <div class="voice-ai-stat">
                <span class="voice-ai-stat-label">Request bulan ini</span>
                <strong>${formatInt(rawElevenLabsUsage.requestCount)}</strong>
            </div>
        </div>
        <p class="voice-ai-summary-meta">
            Limit: ${formatInt(rawElevenLabsUsage.monthlyLimit)} karakter |
            Reserve: ${formatInt(rawElevenLabsUsage.monthlyReserve)} karakter |
            Terakhir dipakai: ${lastUsedAt}
        </p>
    `;
}

async function loadCookiesStatus() {
    setCookiesStatus("Memeriksa status cookies...");
    const response = await fetch("/api/ytdlp-cookies", {
        headers: {
            ...getTokenHeader(),
        },
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
        throw new Error(data.error || "Gagal memuat status cookies.");
    }

    const kind = data.health?.status === "invalid" ? "error" : (data.cookies.exists ? "ok" : "info");
    setCookiesStatus(formatCookieStatus(data.cookies, data.health), kind);
}

async function loadElevenLabsUsageStatus() {
    const response = await fetch("/api/elevenlabs-usage", {
        headers: {
            ...getTokenHeader(),
        },
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
        throw new Error(data.error || "Gagal memuat status ElevenLabs.");
    }

    rawElevenLabsUsage = data.usage || null;
    renderVoiceAiSummary();
}

function readSelectedCookiesFile() {
    const file = cookiesFileInput.files && cookiesFileInput.files[0];
    if (!file) {
        throw new Error("Pilih file cookies.txt dulu.");
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            resolve({
                filename: file.name,
                content: typeof reader.result === "string" ? reader.result : "",
            });
        };
        reader.onerror = () => reject(new Error("Gagal membaca file cookies.txt."));
        reader.readAsText(file);
    });
}

async function uploadCookiesFile() {
    const payload = await readSelectedCookiesFile();
    setCookiesStatus("Mengupload cookies.txt...");

    const response = await fetch("/api/ytdlp-cookies", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...getTokenHeader(),
        },
        body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
        throw new Error(data.error || "Gagal upload cookies.txt.");
    }

    if (cookiesFileInput) {
        cookiesFileInput.value = "";
    }

    const backupInfo = data.backup ? ` Backup config: ${data.backup}` : "";
    setCookiesStatus(`${data.message}${backupInfo}`, "ok");
    if (data.cookies) {
        setTimeout(() => {
            const kind = data.health?.status === "invalid" ? "error" : "ok";
            setCookiesStatus(formatCookieStatus(data.cookies, data.health), kind);
        }, 1200);
    }
}

async function loadConfig() {
    setMainStatus("Memuat konfigurasi utama...");
    const response = await fetch("/api/config", {
        headers: {
            ...getTokenHeader(),
        },
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
        throw new Error(data.error || "Gagal memuat konfigurasi.");
    }

    rawConfig = data.config;
    rawConfigNotes = isObject(data.notes) ? data.notes : {};
    renderConfigForm(formEl, fieldRegistry, rawConfig, rawConfigNotes);
    renderVoiceAiSummary();
    updateVisibleSections();
    setMainStatus(`Terakhir update file: ${data.meta.updatedAt}`, "ok");
}

async function saveConfig() {
    const nextConfig = collectFormValues(fieldRegistry, rawConfig, true);
    setMainStatus("Menyimpan config.json...");

    const response = await fetch("/api/config", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...getTokenHeader(),
        },
        body: JSON.stringify({ config: nextConfig }),
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
        throw new Error(data.error || "Gagal menyimpan konfigurasi.");
    }

    rawConfig = nextConfig;
    setMainStatus(`Berhasil disimpan. Backup: ${data.backup}`, "ok");
    await loadElevenLabsUsageStatus();
}

async function loadLavalinkConfig() {
    setLavalinkStatus("Memuat konfigurasi Lavalink...");
    const response = await fetch("/api/lavalink-config", {
        headers: {
            ...getTokenHeader(),
        },
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
        throw new Error(data.error || "Gagal memuat konfigurasi Lavalink.");
    }

    rawLavalinkConfig = data.config || {};
    renderSimpleForm(lavalinkFormEl, lavalinkFieldRegistry, rawLavalinkConfig, data.notes || {});
    setLavalinkStatus(formatLavalinkStatus(data.meta), data.meta?.running ? "ok" : "info");
}

async function saveLavalinkConfig() {
    const nextConfig = collectFormValues(lavalinkFieldRegistry, rawLavalinkConfig, false);
    setLavalinkStatus("Menyimpan lavalink/application.yml...");

    const response = await fetch("/api/lavalink-config", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...getTokenHeader(),
        },
        body: JSON.stringify({ config: nextConfig }),
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
        throw new Error(data.error || "Gagal menyimpan konfigurasi Lavalink.");
    }

    rawLavalinkConfig = nextConfig;
    setLavalinkStatus(`YAML berhasil disimpan. Backup: ${data.backup}`, "ok");
    await loadLavalinkConfig();
}

async function restartLavalink() {
    setLavalinkStatus("Merestart Lavalink...");
    const response = await fetch("/api/lavalink-restart", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...getTokenHeader(),
        },
        body: JSON.stringify({ restart: true }),
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
        throw new Error(data.error || "Gagal restart Lavalink.");
    }

    const suffix = data.result?.pid ? ` PID baru: ${data.result.pid}` : "";
    setLavalinkStatus(`${data.message}${suffix}`, "ok");
    await loadLavalinkConfig();
}

async function reloadAll() {
    await loadConfig();
    await loadElevenLabsUsageStatus();
    await loadCookiesStatus();
    await loadLavalinkConfig();
}

reloadBtn.addEventListener("click", async () => {
    try {
        await loadConfig();
        await loadElevenLabsUsageStatus();
        await loadCookiesStatus();
    } catch (error) {
        setMainStatus(error.message, "error");
        setCookiesStatus(error.message, "error");
    }
});

saveBtn.addEventListener("click", async () => {
    try {
        await saveConfig();
        await loadCookiesStatus();
    } catch (error) {
        setMainStatus(error.message, "error");
    }
});

reloadLavalinkBtn.addEventListener("click", async () => {
    try {
        await loadLavalinkConfig();
    } catch (error) {
        setLavalinkStatus(error.message, "error");
    }
});

saveLavalinkBtn.addEventListener("click", async () => {
    try {
        await saveLavalinkConfig();
    } catch (error) {
        setLavalinkStatus(error.message, "error");
    }
});

restartLavalinkBtn.addEventListener("click", async () => {
    try {
        await restartLavalink();
    } catch (error) {
        setLavalinkStatus(error.message, "error");
    }
});

uploadCookiesBtn.addEventListener("click", async () => {
    try {
        await uploadCookiesFile();
    } catch (error) {
        setCookiesStatus(error.message, "error");
    }
});

window.addEventListener("DOMContentLoaded", async () => {
    try {
        renderTabBar();
        await reloadAll();
        updateVisibleSections();
    } catch (error) {
        setMainStatus(error.message, "error");
        setCookiesStatus(error.message, "error");
        setLavalinkStatus(error.message, "error");
    }
});
