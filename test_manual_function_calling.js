/**
 * Test script for manual function calling with Gemma models
 */

const { chatCompletion } = require('./ai/completion');
const { runAiAgent } = require('./ai/controller');
const logger = require('./utils/logger');

// Sample tools definition (simplified)
const sampleTools = [
    {
        type: "function",
        function: {
            name: "getRecentMessages",
            description: "Fetch the most recent messages from a Discord text channel. Use this when the user asks about recent discussions.",
            parameters: {
                type: "object",
                properties: {
                    channelId: {
                        type: "string",
                        description: "Discord channel ID."
                    },
                    limit: {
                        type: "integer",
                        description: "Maximum number of items to return.",
                        default: 20
                    }
                },
                required: ["channelId"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "searchWeb",
            description: "Search the public web for real-time information. Use when user asks for 'latest' or 'current' info.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Search query text."
                    },
                    maxResults: {
                        type: "integer",
                        description: "Maximum number of results.",
                        default: 5
                    }
                },
                required: ["query"]
            }
        }
    }
];

const systemPrompt = `You are Yova, a helpful AI assistant.

You must respond ONLY with valid JSON in one of these formats:

1. To call a tool:
{"type": "tool_call", "name": "<tool_name>", "arguments": {<params>}}

2. To ask for clarification:
{"type": "clarify", "question": "<your question>"}

3. To give final answer:
{"type": "final", "message": "<your response>"}

Never output anything except valid JSON.`;

async function testManualFunctionCalling() {
    console.log('\n=== Testing Manual Function Calling with Gemma ===\n');

    // Test 1: Query that should trigger tool call
    console.log('Test 1: Query requiring tool call');
    console.log('User: "Apa yang dibahas di channel ini baru-baru ini?"');

    try {
        const response1 = await chatCompletion({
            system: systemPrompt,
            messages: [
                {
                    role: 'user',
                    content: 'Apa yang dibahas di channel ini baru-baru ini? Channel ID: 123456789'
                }
            ],
            temperature: 0.1,
            maxTokens: 300
        }, {
            tools: sampleTools
        });

        console.log('\nResponse:', JSON.stringify(response1, null, 2));

        // Try to parse if it's a string
        if (typeof response1 === 'string') {
            try {
                const parsed = JSON.parse(response1);
                console.log('\nParsed JSON:', JSON.stringify(parsed, null, 2));

                if (parsed.type === 'tool_call') {
                    console.log('✅ SUCCESS: Model correctly requested tool call!');
                    console.log(`   Tool: ${parsed.name}`);
                    console.log(`   Arguments:`, parsed.arguments);
                } else {
                    console.log('⚠️  Model returned JSON but not a tool_call');
                }
            } catch (e) {
                console.log('❌ FAILED: Response is not valid JSON');
            }
        }
    } catch (error) {
        console.error('❌ ERROR:', error.message);
    }

    console.log('\n' + '='.repeat(60) + '\n');

    // Test 2: Simple query without tools
    console.log('Test 2: Simple query (no tools needed)');
    console.log('User: "Halo, apa kabar?"');

    try {
        const response2 = await chatCompletion({
            system: systemPrompt,
            messages: [
                { role: 'user', content: 'Halo, apa kabar?' }
            ],
            temperature: 0.7,
            maxTokens: 200
        }, {
            tools: sampleTools
        });

        console.log('\nResponse:', JSON.stringify(response2, null, 2));

        if (typeof response2 === 'string') {
            try {
                const parsed = JSON.parse(response2);
                console.log('\nParsed JSON:', JSON.stringify(parsed, null, 2));

                if (parsed.type === 'final') {
                    console.log('✅ SUCCESS: Model correctly gave final answer!');
                    console.log(`   Message: ${parsed.message}`);
                } else {
                    console.log('⚠️  Model returned JSON but not a final answer');
                }
            } catch (e) {
                console.log('❌ FAILED: Response is not valid JSON');
            }
        }
    } catch (error) {
        console.error('❌ ERROR:', error.message);
    }

    console.log('\n' + '='.repeat(60) + '\n');
}

// Run tests
testManualFunctionCalling().then(() => {
    console.log('\n✅ Test completed\n');
    process.exit(0);
}).catch(error => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
});
