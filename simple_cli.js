const readline = require("readline");
const { chatCompletion } = require("./functions/ai/completion");

console.log("=== Simple CLI Test ===\n");

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
            console.log("\nCalling AI...");
            const response = await chatCompletion({
                system: "You are Yova, a helpful assistant.",
                messages: [{ role: 'user', content: input }],
                temperature: 0.7,
                maxTokens: 150
            }, {});

            console.log(`\nYOVA: ${response}\n`);
        } catch (error) {
            console.error("Error:", error.message);
        }

        ask();
    });
};

ask();
