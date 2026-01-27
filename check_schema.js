const { sequelize } = require("./storage/sequelize");

async function check() {
    try {
        const tables = ["QueueStates", "Guilds", "UserQueueHistories"];
        for (const table of tables) {
            console.log(`--- Table: ${table} ---`);
            const [results] = await sequelize.query(`PRAGMA table_info(${table});`);
            console.log(JSON.stringify(results, null, 2));
        }
    } catch (error) {
        console.error("Check failed:", error.message);
    } finally {
        process.exit();
    }
}

check();
