"use strict";

const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn, execSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const LAVALINK_DIR = path.join(ROOT_DIR, "lavalink");
const LAVALINK_JAR_PATH = path.join(LAVALINK_DIR, "Lavalink.jar");
const LAVALINK_LOG_PATH = path.join(LAVALINK_DIR, "logs", "lavalink_server.log");
const LAVALINK_HOST = "127.0.0.1";
const LAVALINK_PORT = 2333;

function resolveJavaBin() {
    const localJavaPath = path.join(LAVALINK_DIR, "jre", "bin", "java");
    if (process.env.JAVA_BIN) {
        return process.env.JAVA_BIN;
    }
    if (fs.existsSync(localJavaPath)) {
        return localJavaPath;
    }
    return "java";
}

function isLavalinkReachable(timeoutMs = 500) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;

        const finish = (value) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(value);
        };

        socket.setTimeout(timeoutMs);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
        socket.connect(LAVALINK_PORT, LAVALINK_HOST);
    });
}

async function waitForLavalinkReady(timeoutMs = 60000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (await isLavalinkReachable(1000)) return true;
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
}

function killLavalinkPort() {
    if (process.platform === "win32") {
        throw new Error("Restart Lavalink dari panel belum didukung di Windows.");
    }

    try {
        execSync(`fuser -k ${LAVALINK_PORT}/tcp`, { stdio: "ignore" });
    } catch (error) {
        // No process on port or fuser unavailable. Continue and let next spawn decide.
    }
}

async function restartLavalinkProcess() {
    if (!fs.existsSync(LAVALINK_JAR_PATH)) {
        throw new Error("Lavalink.jar tidak ditemukan.");
    }

    killLavalinkPort();

    fs.mkdirSync(LAVALINK_DIR, { recursive: true });
    const out = fs.openSync(LAVALINK_LOG_PATH, "a");
    const child = spawn(resolveJavaBin(), ["-jar", LAVALINK_JAR_PATH], {
        cwd: LAVALINK_DIR,
        stdio: ["ignore", out, out],
        detached: true,
    });
    child.unref();

    const ready = await waitForLavalinkReady();
    if (!ready) {
        throw new Error("Timeout menunggu Lavalink online kembali.");
    }

    return {
        ok: true,
        pid: child.pid,
        host: LAVALINK_HOST,
        port: LAVALINK_PORT,
        logPath: LAVALINK_LOG_PATH,
    };
}

module.exports = {
    LAVALINK_HOST,
    LAVALINK_LOG_PATH,
    LAVALINK_PORT,
    isLavalinkReachable,
    restartLavalinkProcess,
};
