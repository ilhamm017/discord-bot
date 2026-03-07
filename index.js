const { connectDB } = require("./storage/sequelize");
const discord = require("./discord");
const logger = require("./utils/logger");
const play = require("play-dl");
const path = require("path");
const fs = require("fs");
const {
  startMediaCacheServer,
  stopMediaCacheServer,
} = require("./utils/common/media_cache_server");

async function main() {
  try {
    // 1. Initialize Core Services (DB, etc.)
    await connectDB();
    const { hydratePlaybackHistories } = require("./discord/player/voice");
    const hydratedHistories = await hydratePlaybackHistories();
    logger.info(`Hydrated ${hydratedHistories} guild playback histories from database.`);

    // 2. Start Lavalink (Infrastructure for premium audio)
    const { spawn, execSync } = require("child_process");
    const lavalinkPath = path.join(__dirname, "lavalink", "Lavalink.jar");
    const localJavaPath = path.join(__dirname, "lavalink", "jre", "bin", "java");
    const javaBin = process.env.JAVA_BIN || (fs.existsSync(localJavaPath) ? localJavaPath : "java");

    // CRITICAL: Clean up existing Lavalink process on the same port
    try {
      if (process.platform !== "win32") {
        execSync("fuser -k 2333/tcp", { stdio: "ignore" });
        logger.info("Cleaning up existing Lavalink processes on port 2333...");
      }
    } catch (e) { }

    logger.info("Starting Lavalink server...");
    startMediaCacheServer();
    const logPath = path.join(__dirname, "lavalink", "logs", "lavalink_server.log");
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const out = fs.openSync(logPath, "a");
    const lavalinkProcess = spawn(javaBin, ["-jar", lavalinkPath], {
      cwd: path.join(__dirname, "lavalink"),
      stdio: ["ignore", out, out],
      detached: false
    });

    lavalinkProcess.on("error", (err) => logger.error("Lavalink process error:", err));

    const cleanup = () => {
      logger.info("Shutting down... Cleaning up processes.");
      stopMediaCacheServer();
      if (lavalinkProcess) {
        lavalinkProcess.kill("SIGTERM");
      }
    };

    process.on("exit", cleanup);
    process.on("SIGINT", () => {
      cleanup();
      process.exit();
    });
    process.on("SIGTERM", () => {
      cleanup();
      process.exit();
    });

    // 3. Wait for Lavalink to be ready
    const net = require("net");
    const waitForLavalink = () => new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const socket = new net.Socket();
        socket.setTimeout(1000);
        socket.on('connect', () => {
          socket.destroy();
          logger.info("Lavalink server is ready!");
          // Give it a tiny bit more time to settle
          setTimeout(resolve, 500);
        });
        socket.on('timeout', () => {
          socket.destroy();
          if (Date.now() - start > 60000) reject(new Error("Timeout waiting for Lavalink"));
          else setTimeout(check, 1000);
        });
        socket.on('error', (err) => {
          socket.destroy();
          if (Date.now() - start > 60000) reject(new Error("Timeout waiting for Lavalink"));
          else setTimeout(check, 1000);
        });
        socket.connect(2333, "127.0.0.1");
      };
      check();
    });

    logger.info("Waiting for Lavalink to initialize (this may take a few seconds)...");
    await waitForLavalink();

    // 4. Start Platforms
    await discord.start();

    // 5. Initialize Lavalink Manager (Immediately after login so client.user is available)
    const lavalinkManager = require("./discord/player/LavalinkManager");
    lavalinkManager.init([{
      id: "local-node",
      host: "127.0.0.1",
      port: 2333,
      authorization: "youshallnotpass",
      secure: false
    }]);

  } catch (error) {
    logger.error("Failed to start application:", error);
    process.exit(1);
  }
}

// Handle unhandled global errors
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", reason);
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", error);
});

main();
