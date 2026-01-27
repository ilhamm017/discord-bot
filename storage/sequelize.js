const { Sequelize } = require("sequelize");
const path = require("path");
const logger = require("../utils/logger");

const dbPath = path.join(__dirname, "..", "database.sqlite");

const sequelize = new Sequelize({
    dialect: "sqlite",
    storage: dbPath,
    logging: (msg) => logger.debug(msg), // Log query SQL ke level debug
});

const connectDB = async () => {
    try {
        await sequelize.authenticate();
        logger.info("Connection to database has been established successfully.");

        // Load all models
        require("../models");

        // Sync models
        await sequelize.sync();

        // Ensure audio_engine column exists (SQLite alter: true is fragile)
        try {
            await sequelize.query("ALTER TABLE Guilds ADD COLUMN audio_engine TEXT DEFAULT 'ffmpeg'");
            logger.info("Added audio_engine column to Guilds table.");
        } catch (error) {
            if (!error.message.includes("duplicate column name")) {
                logger.debug("Column audio_engine already exists or other error:", error.message);
            }
        }

        try {
            await sequelize.query("ALTER TABLE QueueItems ADD COLUMN metadataJson TEXT");
            logger.info("Added metadataJson column to QueueItems table.");
        } catch (error) {
            if (!error.message.includes("duplicate column name")) {
                logger.debug("Column metadataJson already exists or other error:", error.message);
            }
        }

        logger.info("Database models synchronized.");
    } catch (error) {
        logger.error("Unable to connect to the database:", error);
    }
};

module.exports = { sequelize, connectDB };
