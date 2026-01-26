const { connectDB } = require("./storage/sequelize");
const discord = require("./discord");
const logger = require("./utils/logger");

async function main() {
  try {
    // 1. Initialize Core Services (DB, etc.)
    await connectDB();

    // 2. Start Platforms
    await discord.start();

    // Future: await whatsapp.start();

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
