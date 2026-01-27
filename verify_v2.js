const config = require("./config.json");
const apiKey = config.google_api_key || process.env.GOOGLE_API_KEY;

const modelsToTest = [
    "gemini-2.0-flash-exp",   // Got 429 (Rate Limit) -> Good sign it exists
    "gemini-2.0-flash",       // Got 403 (Forbidden) -> Maybe strictly exp key?
    "gemini-flash-latest",    // Alias
    "gemini-2.0-flash-001"    // Specific ver
];

async function testStart() {
    console.log("Re-testing valid candidates from your list...\n");

    for (const model of modelsToTest) {
        process.stdout.write(`Testing ${model.padEnd(25)} ... `);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: "Hi" }] }]
                })
            });

            if (resp.ok) {
                const json = await resp.json();
                const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "OK (No text)";
                console.log(`✅ SUCCESS\n   Response: ${text.substring(0, 50)}...`);
            } else {
                console.log(`❌ Failed (${resp.status}: ${resp.statusText})`);
                if (resp.status === 429) console.log("   (Rate Limit - Model exists!)");
                if (resp.status === 404) console.log("   (Model Not Found)");
            }
        } catch (e) {
            console.log(`❌ Error: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 1000)); // 1s delay
    }
}

testStart();
