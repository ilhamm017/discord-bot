const readline = require("readline");
const { connectDB } = require("../../storage/sequelize"); // Adjust path if necessary. Based on index.js, it's ./storage/sequelize
// from /functions/adapters/cli.js, path to storage is ../../storage/sequelize
const { runAiAgent } = require("../ai/controller"); // ../ai/controller

async function startCli() {
    try {
        console.log("Connecting to DB...");
        await connectDB();
        console.log("--- YOVA CLI (Universal AI Test) ---");
        console.log("--- Capabilities: [web, memory, session, system] (NO Discord) ---");

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const ask = () => {
            rl.question("> ", async (input) => {
                if (input.toLowerCase() === "exit") {
                    rl.close();
                    process.exit(0);
                }

                try {
                    const context = {
                        source: "cli",
                        userId: "console_user_001",
                        sessionId: "cli-session-1",
                        guildId: "cli_guild_01",
                        channelId: "cli_channel_01",
                        capabilities: ["web", "memory", "session", "system"], // Explicitly NO discord
                        serverContext: "User is interacting via CLI (Command Line Interface). Location: Server Console."
                    };

                    const response = await runAiAgent(input, context);

                    // Debug: log response structure
                    console.log(`\n[DEBUG] Response:`, JSON.stringify(response, null, 2));

                    if (response.type === "final" || response.type === "reply") {
                        const msg = response.message || response.content || "(empty response)";
                        console.log(`\nYOVA: ${msg}\n`);
                    } else if (response.type === "tool_call") {
                        console.log(`\n[TOOL CALL REQUEST]: ${response.name} (${JSON.stringify(response.arguments)})\n`);
                        // In a real adapter, we would execute this and feed it back.
                        // But for now, we just show what it WANTED to do.
                    } else {
                        console.log(`\nRAW RESPONSE: ${JSON.stringify(response, null, 2)}\n`);
                    }
                } catch (error) {
                    console.error("Error:", error);
                }

                ask();
            });
        };

        ask();
    } catch (e) {
        console.error("Failed to start CLI:", e);
    }
}

if (require.main === module) {
    startCli();
}

module.exports = { startCli };
