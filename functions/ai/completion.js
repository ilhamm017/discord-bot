const logger = require("../../utils/logger");
const { analyzeComplexity } = require("./complexity_analyzer");
const { selectModel, markRateLimited } = require("./model_selector");
const { convertToolsToTextDescription } = require("./tools_to_text");
const { getRateLimiter } = require("./rate_limiter");

// Default tier for Gemma models
const DEFAULT_TIER = "balanced";

function getConfig() {
    let config = {};
    try {
        config = require("../../config.json");
    } catch (error) {
        config = {};
    }

    // PRIORITIZE GOOGLE_API_KEY
    const apiKey =
        config.google_api_key ||
        config.googleApiKey ||
        process.env.GOOGLE_API_KEY;

    return { apiKey, config };
}

/**
 * Convert OpenAI-style messages to Google Generative AI format
 */
/**
 * Convert OpenAI-style messages to Google Generative AI format
 */
function convertMessagesToGoogleFormat(messages, system) {
    const contents = [];
    let systemInstruction = null;

    // 1. Handle System Prompt
    if (system) {
        systemInstruction = {
            parts: [{ text: system }]
        };
    }

    // 2. Handle Message History
    if (Array.isArray(messages)) {
        for (const msg of messages) {
            // Check for valid message content or tool calls
            const hasContent = msg.content && typeof msg.content === 'string';
            const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
            const isToolResponse = msg.role === 'tool';

            // Skip empty messages (unless it's a tool call which might have null content)
            if (!hasContent && !hasToolCalls && !isToolResponse) continue;

            // Map roles
            if (msg.role === 'system') {
                systemInstruction = { parts: [{ text: msg.content }] };
                continue;
            }

            let role = 'user';
            let parts = [];

            if (msg.role === 'assistant') {
                role = 'model';
                if (hasToolCalls) {
                    msg.tool_calls.forEach(tc => {
                        let args = {};
                        try {
                            args = typeof tc.function.arguments === 'string'
                                ? JSON.parse(tc.function.arguments)
                                : tc.function.arguments;
                        } catch (e) { args = {}; }
                        parts.push({ functionCall: { name: tc.function.name, args: args } });
                    });
                }
                if (hasContent) {
                    parts.push({ text: msg.content });
                }
            } else if (msg.role === 'tool') {
                role = 'function';
                let responseObj = { content: msg.content };
                try {
                    if (typeof msg.content === 'string' && (msg.content.startsWith('{') || msg.content.startsWith('['))) {
                        responseObj = JSON.parse(msg.content);
                    }
                } catch (e) { }
                parts.push({ functionResponse: { name: msg.name, response: responseObj } });
            } else {
                if (hasContent) {
                    parts.push({ text: msg.content });
                }
            }

            if (parts.length > 0) {
                // MERGE logic: Google requires strict alternation: User -> Model -> User -> Model
                const lastContent = contents[contents.length - 1];
                if (lastContent && lastContent.role === role) {
                    lastContent.parts.push(...parts);
                } else {
                    contents.push({ role, parts });
                }
            }
        }
    }

    return { contents, systemInstruction };
}

/**
 * Convert OpenAI Tool Definitions to Google Function Declarations
 */
function convertToolsToGoogleFormat(openaiTools) {
    if (!Array.isArray(openaiTools)) return undefined;

    const functionDeclarations = openaiTools
        .filter(t => t.type === 'function' && t.function)
        .map(t => {
            // Google strict strictness on schemas, but mostly compatible.
            // We ensure parameters are set.
            return {
                name: t.function.name,
                description: t.function.description,
                parameters: t.function.parameters
            };
        });

    if (functionDeclarations.length === 0) return undefined;

    return [{ functionDeclarations }];
}

/**
 * Call Groq AI as backup
 */
async function callGroqAI(apiKey, model, params) {
    const url = "https://api.groq.com/openai/v1/chat/completions";

    // Convert to OpenAI format (Groq is OpenAI compatible)
    let messages = [];
    if (params.system) messages.push({ role: "system", content: params.system });
    if (params.messages) {
        // Simple map, assuming compatible structure or basic content
        messages = messages.concat(params.messages.map(m => {
            const msg = {
                role: m.role,
                content: m.content || "",
            };
            if (m.tool_calls) msg.tool_calls = m.tool_calls;
            if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
            if (m.name) msg.name = m.name;
            return msg;
        }));
    } else if (params.user) {
        messages.push({ role: "user", content: params.user });
    }


    const body = {
        model: model,
        messages: messages,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        // Strip tags from tools before sending to Groq
        tools: Array.isArray(params.tools) ? params.tools.map(t => {
            if (t.function) {
                const { tags, ...cleanFn } = t.function;
                return { ...t, function: cleanFn };
            }
            const { tags, ...cleanTool } = t;
            return cleanTool;
        }) : undefined,
        tool_choice: params.tools ? "auto" : undefined,
    };

    // Groq Constraint: json_object cannot be used with tools/function calling
    if (!params.tools) {
        body.response_format = { type: "json_object" };
    }

    logger.info(`[GROQ_RAW_REQUEST]`, body);

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        logger.error(`[GROQ_ERROR_RESPONSE]: ${JSON.stringify(err, null, 2)}`);
        throw new Error(err.error?.message || response.statusText);
    }

    const data = await response.json();
    logger.info(`[GROQ_RAW_RESPONSE]`, data);
    const choice = data.choices[0];

    // Return compatible format (OpenAI style)
    const message = choice.message;
    if (message && typeof message.content === 'string') {
        // Strip <think>...</think> tags which some models (like DeepSeek family) output
        message.content = message.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    }
    return message;
}

/**
 * Filter tools based on detected intent to reduce prompt size
 */
function filterToolsByIntent(intent, tools) {
    if (!Array.isArray(tools)) return undefined;

    const intentMap = {
        'music': ['music'],
        'search': ['web'],
        'member': ['discord_member', 'memory'],
        'moderation': ['discord_moderation'],
        'reminder': ['reminder'],
        'history': ['discord_message'],
        'stats': ['system'],
        'social': ['discord_messaging']
    };

    const intentToolAllowlist = {
        member: ['listMembers', 'getMemberById', 'getMemberByName', 'getUserProfile', 'setUserProfile', 'getUserMemory', 'setUserMemory', 'clearUserMemory', 'locateUser', 'findUserLocation', 'sendMessage', 'replyToMessage', 'getServerInfo'],
        history: ['getRecentMessages', 'getMessagesBefore', 'getMessagesAfter', 'getMessagesAround', 'getMessageById', 'getLastMessageByUser', 'searchStoredMessages'],
        moderation: ['deleteMessage', 'bulkDeleteMessages', 'timeoutMember', 'removeTimeout', 'banMember', 'unbanMember'],
        reminder: ['createReminder', 'listUserReminders', 'cancelReminder'],
        search: ['searchWeb'],
        social: ['sendMessage', 'replyToMessage', 'sendAnnouncement', 'locateUser', 'findUserLocation', 'getServerInfo'],
        music: ['playMusic', 'controlMusic', 'getMusicStatus'],
        stats: ['getAiStats', 'getServerInfo']
    };

    const allowedTags = intentMap[intent] || ['system'];
    const allowlist = intentToolAllowlist[intent];

    let filtered;
    if (Array.isArray(allowlist)) {
        filtered = tools.filter(t => {
            const name = t.function?.name || t.name;
            return allowlist.includes(name);
        });
    } else {
        filtered = tools.filter(t => {
            const tags = t.tags || (t.function && t.function.tags);
            return tags && tags.some(tag => allowedTags.includes(tag));
        });
    }

    return filtered.length > 0 ? filtered : undefined;
}

async function chatCompletion({
    system,
    user,
    messages,
    temperature = 0.7,
    maxTokens = 250,
}, options = {}) {
    const { apiKey, config } = getConfig();
    if (!apiKey) {
        throw new Error("GOOGLE_API_KEY_MISSING: Please add google_api_key to config.json");
    }

    // Prepare Payload
    let inputMessages = [];
    if (Array.isArray(messages) && messages.length > 0) {
        inputMessages = messages;
    } else {
        // Fallback for simple user prompt
        if (user) inputMessages.push({ role: 'user', content: user });
    }

    // Extract the ACTUAL current query for intent analysis (don't join history)
    // This prevents "sticky" intents from previous messages.
    const currentUserMessage = user || [...inputMessages].reverse().find(m => m.role === 'user')?.content || "";

    const { contents, systemInstruction } = convertMessagesToGoogleFormat(inputMessages, system);

    // Analyze complexity based on the CURRENT message only
    const { tier, provider: preferredProvider, intent, needsHistory, needsMentions, needsTool, isReplyingToQuestion } = analyzeComplexity(currentUserMessage, {
        messages: inputMessages,
        tools: options.tools,
        isReply: options.isReply
    });

    // History De-duplication: Prevent "Broken Record" loops
    const assistantMsgs = inputMessages.filter(m => m.role === 'assistant' && typeof m.content === 'string');
    if (assistantMsgs.length >= 1) {
        let isLoopDetected = false;

        // 1. Detect internal loops in ANY previous assistant message
        for (const msg of assistantMsgs) {
            const content = msg.content.trim();
            if (content.length > 40) {
                // Check for repetitive blocks of 20 chars
                for (let i = 0; i < Math.min(content.length - 40, 100); i += 5) {
                    const chunk = content.slice(i, i + 20);
                    if (content.indexOf(chunk, i + 20) !== -1) {
                        isLoopDetected = true;
                        break;
                    }
                }
            }
            if (isLoopDetected) break;
        }

        // 2. Detect sequence loops (reversion to previous identical answer)
        if (!isLoopDetected && assistantMsgs.length >= 2) {
            const lastContent = assistantMsgs[assistantMsgs.length - 1].content.trim();
            const previousInstances = assistantMsgs.slice(0, -1).filter(m => {
                const prev = m.content.trim();
                return prev === lastContent || (prev.length > 20 && lastContent.includes(prev.slice(0, 20)));
            });
            if (previousInstances.length > 0) isLoopDetected = true;
        }

        if (isLoopDetected) {
            logger.warn(`Broken record detected in assistant history. Performing aggressive reset.`);

            // AGGRESSIVE RESET: Remove Assistant context, BUT keep tool calls to avoid breaking the chain
            // The AI will only see the system instructions, user history, and its own tool calls (essential for tool results).
            inputMessages = inputMessages.filter(m => {
                if (m.role !== 'assistant') return true;
                // Keep assistant message IF it has tool_calls (otherwise the subsequent 'tool' message is orphaned)
                if (m.tool_calls && m.tool_calls.length > 0) return true;
                return false;
            });
            logger.info("Aggressive reset: Assistant text history cleared (tool calls preserved).");
        }
    }

    // 5. Dynamic Temperature & History Pruning
    const finalTemperature = (intent === 'general' || intent === 'history') ? 0.7 : (options.temperature || temperature || 0.1);

    let filteredMessages = inputMessages;
    if (!needsHistory) {
        // For general chat, keep a bit more history (e.g., last 5 messages) for natural flow
        // For tool-tasks, last 2 is usually enough.
        let historySize = intent === 'general' ? 6 : 2;

        // FRESH START LOGIC: Truly random chat (no reply, no history mention, no bot question pending)
        // Also check if context is "stale" (e.g. more than 15 minutes old)
        const STALE_THRESHOLD_MS = 15 * 60 * 1000;
        const lastRelevantMsg = inputMessages.filter(m => m.role !== 'system').slice(-1)[0];
        const isStale = lastRelevantMsg?.timestamp && (Date.now() - lastRelevantMsg.timestamp > STALE_THRESHOLD_MS);

        if (!options.isReply && !needsHistory && !isReplyingToQuestion && (isStale || intent === 'general')) {
            historySize = 0; // Completely fresh start
            logger.debug(`Fresh start detected (isStale: ${!!isStale}). History cleared.`);
        }

        const systemMsg = inputMessages.find(m => m.role === 'system');
        const tail = inputMessages.filter(m => m.role !== 'system').slice(-historySize);
        filteredMessages = systemMsg ? [systemMsg, ...tail] : tail;
        logger.debug(`History pruned (intent: ${intent}, size: ${historySize}). Kept ${filteredMessages.length} messages.`);
    }

    // New Tool Pruning Logic: Drastically reduces prompt bloat and latency
    const filteredTools = (needsTool && Array.isArray(options.tools)) ? filterToolsByIntent(intent, options.tools) : undefined;
    if (filteredTools) {
        logger.info(`Contextual Tool Pruning: Reduced toolset for intent "${intent}" (${filteredTools.length} tools kept).`);
    } else {
        logger.info(`Contextual Tool Pruning: No tools kept for intent "${intent}" (needsTool: ${needsTool}).`);
    }

    // Re-generate Google format with filtered messages
    const { contents: filteredContents, systemInstruction: filteredSystem } = convertMessagesToGoogleFormat(filteredMessages, system);

    // Initialize Rate Limiter
    const rateLimiter = getRateLimiter({
        maxTPM: config.google_tpm_limit || 15000,
        safetyMargin: config.google_tpm_safety_margin || 0.8
    });

    // Strategy Function for Google AI
    const runGoogleAttempt = async (currentRequestId) => {
        let currentTier = tier;
        let lastError = null;
        const maxAttempts = 4;
        const visitedTiers = new Set([tier]);

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const currentModel = selectModel(currentTier, config, 'google');
            logger.info(`Google Attempt ${attempt + 1}/${maxAttempts}: Using ${currentModel} (${currentTier})`);

            if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt));

            const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
            const isGemmaModel = currentModel.toLowerCase().includes('gemma');
            const body = {
                contents: filteredContents, // Use filtered contents
                generationConfig: {
                    temperature: finalTemperature,
                    maxOutputTokens: maxTokens
                }
            };

            if (filteredSystem && !isGemmaModel) body.systemInstruction = filteredSystem;

            if (isGemmaModel) {
                // Gemma logic wrapping
                const convertedContents = body.contents.map(msg => {
                    if (!msg.parts) return msg;
                    const hasFunctionParts = msg.parts.some(p => p.functionCall || p.functionResponse);
                    if (!hasFunctionParts) return msg;
                    const textParts = msg.parts.map(part => {
                        if (part.functionCall) {
                            return { text: JSON.stringify({ type: "tool_call", name: part.functionCall.name, arguments: part.functionCall.args }) };
                        } else if (part.functionResponse) {
                            return { text: `Tool "${part.functionResponse.name}" returned: ${JSON.stringify(part.functionResponse.response)}` };
                        }
                        return part;
                    });
                    let role = msg.role === 'function' ? 'user' : msg.role;
                    return { ...msg, role, parts: textParts };
                });
                body.contents = convertedContents;

                if (filteredSystem && body.contents.length > 0) {
                    let systemText = filteredSystem.parts[0].text;
                    if (filteredTools) {
                        systemText += "\n\nAVAILABLE TOOLS (You can use these):\n" + convertToolsToTextDescription(filteredTools);
                    }

                    const firstMsg = body.contents[0];
                    if (firstMsg.role === 'user' && firstMsg.parts && firstMsg.parts[0]) {
                        // Concatenate with existing first user message
                        body.contents[0].parts[0].text = `SYSTEM_INSTRUCTION:\n${systemText}\n\nUSER_REQUEST:\n${firstMsg.parts[0].text}`;
                    } else {
                        // Prepend a new user message for instructions if history starts with model/assistant
                        body.contents.unshift({
                            role: 'user',
                            parts: [{ text: `SYSTEM_INSTRUCTION:\n${systemText}\n\nPlease proceed with the following context.` }]
                        });
                    }
                }
            }

            // ONLY send tools to Gemini if needsTool is true
            if (needsTool && filteredTools && !isGemmaModel) {
                const googleTools = convertToolsToGoogleFormat(filteredTools);
                if (googleTools) body.tools = googleTools;
            }

            try {
                logger.info(`[GOOGLE_RAW_REQUEST]`, body);
                const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    logger.error(`[GOOGLE_ERROR_RESPONSE]: ${JSON.stringify(errorData, null, 2)}`);
                    const errorMessage = errorData.error?.message || response.statusText;

                    if ([429, 500, 503, 504].includes(response.status)) {
                        markRateLimited(currentModel, response.status === 429 ? config.google_rate_limit_cooldown_ms : 60000);
                        visitedTiers.add(currentTier);
                        currentTier = getNextFallbackTier(currentTier, visitedTiers);
                        continue;
                    }
                    throw new Error(`Google Error ${response.status}: ${errorMessage}`);
                }

                const data = await response.json();
                logger.info(`[GOOGLE_RAW_RESPONSE]`, data);
                if (data.usageMetadata?.totalTokenCount) rateLimiter.recordUsage(currentRequestId, data.usageMetadata.totalTokenCount);

                const candidate = data.candidates?.[0];
                const contentParts = candidate?.content?.parts;

                if (contentParts && contentParts.length > 0) {
                    const functionCalls = contentParts.filter(p => p.functionCall);
                    if (functionCalls.length > 0) {
                        return {
                            role: "assistant", content: null, tool_calls: functionCalls.map(p => ({
                                id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                type: "function",
                                function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args) }
                            }))
                        };
                    }
                    return contentParts.map(p => p.text).join("").trim();
                }
                throw new Error("Empty response from Google");
            } catch (err) {
                logger.warn(`Google attempt ${attempt + 1} failed: ${err.message}`);
                lastError = err;
                visitedTiers.add(currentTier);
                currentTier = getNextFallbackTier(currentTier, visitedTiers);
            }
        }
        throw lastError;
    };

    // Strategy Function for Groq AI
    const runGroqAttempt = async () => {
        let groqTier = tier;
        const groqAttempts = 3;
        const groqVisited = new Set();
        let groqLastError = null;

        // Tool list is already filtered globally

        // Token Optimization: Limit history for Groq
        const groqMessages = filteredMessages; // Already pruned globally above

        const groqNoToolModels = new Set(["allam-2-7b", "groq/compound-mini"]);
        const needsToolCall = Array.isArray(filteredTools) && filteredTools.length > 0;

        // Force advanced model for complex tool interactions or existing tool history
        // This prevents "dumb" models (like Llama 8b) from hallucinating on tool outputs
        if (filteredMessages.some(m => m.role === 'tool' || m.tool_calls)) {
            groqTier = 'advanced';
        }

        for (let gAttempt = 0; gAttempt < groqAttempts; gAttempt++) {
            const groqModel = selectModel(groqTier, config, 'groq');
            logger.info(`Groq Attempt ${gAttempt + 1}/${groqAttempts}: Using ${groqModel} (${groqTier})`);
            if (needsToolCall && groqNoToolModels.has(groqModel)) {
                logger.warn(`Groq model ${groqModel} does not support tool calling. Skipping.`);
                groqVisited.add(groqTier);
                groqTier = getNextFallbackTier(groqTier, groqVisited);
                continue;
            }

            try {
                const response = await callGroqAI(config.groq_api_key, groqModel, {
                    system, user,
                    messages: groqMessages,
                    temperature: finalTemperature, maxTokens,
                    tools: filteredTools
                });

                // ADDITIONAL SAFETY: Verify Groq didn't hallucinate a tool NOT in the provided list
                if (response && response.tool_calls) {
                    const validToolNames = new Set(filteredTools.map(t => t.function?.name || t.name));
                    const hasInvalid = response.tool_calls.some(tc => !validToolNames.has(tc.function.name));
                    if (hasInvalid) {
                        logger.error(`Groq ${groqModel} hallucinated an invalid tool call. Invalid tools: ${response.tool_calls.filter(tc => !validToolNames.has(tc.function.name)).map(tc => tc.function.name).join(", ")}`);
                        throw new Error(`Invalid tool call detected in Groq response for ${groqModel}.`);
                    }
                }

                return response;
            } catch (groqError) {
                logger.warn(`Groq attempt ${gAttempt + 1} failed for ${groqModel}: ${groqError.message}`);
                groqLastError = groqError;
                const errMsg = groqError.message.toLowerCase();
                const isRate = errMsg.includes("429") || errMsg.includes("rate limit") || errMsg.includes("tokens per minute");

                if (isRate || groqError.message.includes("503")) {
                    markRateLimited(groqModel, isRate ? 300000 : 60000);
                    groqVisited.add(groqTier);
                    groqTier = getNextFallbackTier(groqTier, groqVisited);
                    continue;
                }

                groqVisited.add(groqTier);
                groqTier = getNextFallbackTier(groqTier, groqVisited);
            }
        }
        throw groqLastError;
    };

    return rateLimiter.executeRequest(async (requestId) => {
        if (preferredProvider === 'groq' && config.groq_api_key) {
            try {
                return await runGroqAttempt();
            } catch (e) {
                logger.warn("Preferred Groq failed, falling back to Google...");
                return await runGoogleAttempt(requestId);
            }
        } else {
            try {
                return await runGoogleAttempt(requestId);
            } catch (e) {
                if (config.groq_api_key) {
                    logger.warn("Preferred Google failed, falling back to Groq...");
                    return await runGroqAttempt();
                }
                throw e;
            }
        }
    }, { system, user, messages: filteredMessages, maxTokens, tools: needsTool ? options.tools : undefined });
}

// Keep helper functions getNextFallbackTier etc as they were
function getNextFallbackTier(current, visited) {
    const strategies = {
        'premium': ['advanced', 'balanced', 'lightweight'],
        'advanced': ['premium', 'balanced', 'lightweight'],
        'balanced': ['advanced', 'premium', 'lightweight'],
        'lightweight': ['balanced', 'advanced', 'premium']
    };
    const candidates = strategies[current] || [];
    for (const cand of candidates) {
        if (!visited.has(cand)) return cand;
    }
    return current;
}

module.exports = {
    chatCompletion
};
