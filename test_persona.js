/**
 * Test script for Yova's new concise persona
 */

const { runAiAgent } = require('./functions/ai/controller');

async function testPersonaEfficiency() {
    console.log('\n=== Testing Yova Personality Efficiency ===\n');

    const context = {
        source: "test",
        userId: "123",
        guildId: "456",
        channelId: "789",
        sessionId: "test-persona",
        capabilities: ["discord"],
        serverContext: "User: Good Boy"
    };

    // Test Case: Tiny input that previously caused huge response
    console.log('Testing Input: "yova kangen"');

    try {
        const response = await runAiAgent("yova kangen", context);
        console.log('\nResponse:', JSON.stringify(response, null, 2));

        if (response.type === 'final') {
            const length = response.message.length;
            const words = response.message.split(' ').length;
            console.log(`\nLength: ${length} chars, ${words} words`);

            if (words <= 15) {
                console.log('✅ SUCCESS: Response is concise and token-efficient!');
            } else {
                console.log('⚠️  WARNING: Response is still quite long.');
            }
        }
    } catch (error) {
        console.error('❌ ERROR:', error.message);
    }

    console.log('\n' + '='.repeat(50) + '\n');
}

testPersonaEfficiency();
