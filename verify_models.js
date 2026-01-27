const config = require("./config.json");
const apiKey = config.google_api_key || process.env.GOOGLE_API_KEY;

if (!apiKey) {
    console.error("Error: google_api_key missing.");
    process.exit(1);
}

const modelsToTest = [
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "gemini-2.0-flash",
    "gemini-2.0-flash-exp",
    "gemini-2.0-flash-001"
];

async function testSpecificModels() {
    console.log("Verifying specific models...\n");
    const results = [];

    for (const model of modelsToTest) {
        process.stdout.write(`Testing ${model.padEnd(25)} ... `);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const start = Date.now();
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: "Hello, reply with 'OK'." }] }]
                })
            });
            const latency = Date.now() - start;

            if (resp.ok) {
                const json = await resp.json();
                const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

                if (text) {
                    console.log(`✅ OK (${latency}ms) - Response: "${text}"`);
                    results.push({ model, status: "OK", latency: `${latency}ms` });
                } else {
                    console.log("⚠️  Empty Response");
                    results.push({ model, status: "Empty", latency: `${latency}ms` });
                }
            } else {
                console.log(`❌ Failed (${resp.status})`);
                results.push({ model, status: `Failed: ${resp.status}`, latency: "-" });
            }
        } catch (e) {
            console.log(`❌ Error: ${e.message}`);
            results.push({ model, status: "Error", latency: "-" });
        }
    }

    console.log("\n--- VERIFICATION SUMMARY ---");
    console.table(results);
}

testSpecificModels();
