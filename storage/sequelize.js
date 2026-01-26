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

        // Sync models
        await sequelize.sync();
        logger.info("Database models synchronized.");
    } catch (error) {
        logger.error("Unable to connect to the database:", error);
    }
};

module.exports = { sequelize, connectDB };
