const { runAiAgent } = require("./functions/ai/controller");

async function test() {
    console.log("Testing AI agent...");

    const context = {
        source: "cli",
        userId: "test_user",
        sessionId: "test-session",
        guildId: "test_guild",
        channelId: "test_channel",
        capabilities: ["web", "memory", "session", "system"],
        serverContext: "Test environment"
    };

    try {
        console.log("Calling runAiAgent...");
        const response = await runAiAgent("Hai", context);
        console.log("\nResponse received:");
        console.log(JSON.stringify(response, null, 2));
    } catch (error) {
        console.error("Error:", error);
    }
}

test();
