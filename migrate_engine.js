const { sequelize } = require("./storage/sequelize");

async function migrate() {
    try {
        console.log("Adding 'engine' column to QueueStates table...");
        await sequelize.query("ALTER TABLE QueueStates ADD COLUMN engine VARCHAR(255) DEFAULT 'ffmpeg';");
        console.log("Migration successful!");
    } catch (error) {
        if (error.message.includes("duplicate column name")) {
            console.log("Column 'engine' already exists.");
        } else {
            console.error("Migration failed:", error.message);
        }
    } finally {
        process.exit();
    }
}

migrate();
