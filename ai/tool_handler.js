const platform = require("../functions/platform");
const logger = require("../utils/logger");

function parseToolArguments(raw, name) {
    if (raw === undefined || raw === null) {
        logger.warn(`Tool call "${name}" missing arguments; using empty object.`);
        return {};
    }
    if (typeof raw === 'object') {
        return raw;
    }
    if (typeof raw !== 'string') {
        logger.warn(`Tool call "${name}" has invalid arguments type; using empty object.`, {
            type: typeof raw
        });
        return {};
    }
    if (!raw.trim()) {
        logger.warn(`Tool call "${name}" has empty arguments; using empty object.`);
        return {};
    }
    try {
        return JSON.parse(raw);
    } catch (error) {
        logger.warn(`Tool call "${name}" arguments are not valid JSON; using empty object.`);
        return {};
    }
}

/**
 * Dispatches a tool call to the corresponding platform function.
 */
async function callTool(name, args, context = {}) {
    logger.debug(`Dispatching tool call: ${name}`, args);

    // List of tools that are handled internally in this file and don't need a direct platform mapping
    const internalTools = ['getAiStats', 'controlMusic', 'locateUser'];

    if (!internalTools.includes(name) && typeof platform[name] !== 'function') {
        logger.warn(`Tool not found or not a function: ${name}`);
        return { error: `Tool ${name} is not implemented.` };
    }

    try {
        // Validation check (optional, but good for security)
        if (platform.checkUserPermission && context.userId && context.guildId) {
            // Some tools might need permission checks
            const highRiskActions = [
                'deleteMessage', 'bulkDeleteMessages', 'timeoutMember',
                'banMember', 'unbanMember', 'addRoleToMember',
                'removeRoleFromMember', 'setMemberRoles'
            ];

            if (highRiskActions.includes(name)) {
                const actionType = name.toUpperCase().replace(/[A-Z]/g, letter => `_${letter}`).slice(1);
                const perm = await platform.checkUserPermission(context.guildId, context.userId, actionType);
                if (!perm.allowed) {
                    return { error: `Permission denied: ${perm.reason}` };
                }
            }
        }

        let result;
        // 1. Flatten hallucinated sub-objects (common in some Llama/Qwen variants)
        const subkeyNames = ['kwargs', 'params', 'toolParams', 'tool_params', 'parameters'];
        for (const sk of subkeyNames) {
            if (args[sk] && typeof args[sk] === 'object') {
                logger.debug(`Flattening hallucinated subkey "${sk}" into tool arguments.`);
                Object.assign(args, args[sk]);
            }
        }

        // 2. Argument Normalization: Map common variant names to standard ones
        const userIdSynonyms = ['id', 'username', 'user', 'target', 'member', 'targetUserId', 'userIdOrName', 'target_id', 'target_user', 'member_id', 'recipient', 'to'];
        const channelIdSynonyms = ['channel', 'channel_id', 'targetChannel', 'target_channel', 'where'];
        const guildIdSynonyms = ['guild', 'guild_id', 'server', 'server_id'];
        const contentSynonyms = ['message', 'text', 'body', 'content_text', 'msg'];

        if (!args.userId) {
            for (const syn of userIdSynonyms) {
                if (args[syn]) { args.userId = args[syn]; break; }
            }
        }
        if (!args.channelId) {
            for (const syn of channelIdSynonyms) {
                if (args[syn]) { args.channelId = args[syn]; break; }
            }
        }
        if (!args.guildId) {
            for (const syn of guildIdSynonyms) {
                if (args[syn]) { args.guildId = args[syn]; break; }
            }
        }
        if (!args.content) {
            for (const syn of contentSynonyms) {
                if (args[syn]) { args.content = args[syn]; break; }
            }
        }

        if (name === "playMusic") {
            if (!args.query) {
                const playQuerySynonyms = ["sound_effect", "soundEffect", "song", "title", "track", "audio"];
                for (const syn of playQuerySynonyms) {
                    if (args[syn]) {
                        args.query = args[syn];
                        break;
                    }
                }
            }

            if (!args.targetUserId) {
                const playTargetSynonyms = ["target_user", "targetUser", "recipient", "to", "member"];
                for (const syn of playTargetSynonyms) {
                    if (args[syn]) {
                        args.targetUserId = args[syn];
                        break;
                    }
                }
            }

            if (!args.source) {
                const loweredQuery = String(args.query || "").toLowerCase();
                if (
                    args.sound_effect ||
                    /\b(sound\s*effects?|soundboard|sfx|efek\s+suara|myinstants?)\b/i.test(loweredQuery)
                ) {
                    args.source = "myinstants";
                }
            }
        }

        // Helper to validate and ensure we have required IDs
        // STRICTER CHECK: Must be numeric-ish (snowflake) and > 10 chars. Rejects names/placeholders.
        const isSnowflake = (id) => id && (typeof id === 'string' || typeof id === 'number') && String(id).trim().length > 10 && /^\d+$/.test(String(id));

        // 1. Resolve Guild ID (gid)
        let gid = isSnowflake(args.guildId) ? String(args.guildId) : String(context.guildId);
        if (args.guildId && !isSnowflake(args.guildId)) {
            logger.warn(`AI sent invalid guildId: "${args.guildId}". Falling back to context: ${gid}`);
        }

        // 2. Resolve Channel ID (cid)
        let cidInput = args.channelId;
        // If AI sends the Guild ID in the channelId field, ignore it
        if (cidInput === context.guildId || cidInput === gid) cidInput = null;

        let cid = isSnowflake(cidInput) ? String(cidInput) : (isSnowflake(context.channelId) ? String(context.channelId) : null);
        if (args.channelId && !isSnowflake(args.channelId) && args.channelId !== context.guildId) {
            logger.warn(`AI sent invalid channelId: "${args.channelId}". Falling back to: ${cid}`);
        }

        // 3. Logic for userId:
        const targetUid = args.userId || (['getUserProfile', 'getUserMemory', 'setUserProfile', 'setUserMemory'].includes(name) ? context.userId : null);

        // Map findUserLocation/sendMessage to use the target
        if (['findUserLocation', 'locateUser'].includes(name) && !targetUid) {
            return { error: "Yova bingung, mau nyari siapa? (userId/username missing). Coba panggil locateUser dengan userId yang benar." };
        }


        // Mapping named arguments to positional arguments based on platform function signatures
        switch (name) {
            case 'getMusicStatus': result = await platform.getMusicStatus(gid); break;
            case 'getServerInfo': result = await platform.getServerInfo(gid, cid, context.userId); break;
            case 'getRecentMessages': result = await platform.getRecentMessages(cid, args.limit); break;
            case 'getMessagesBefore': result = await platform.getMessagesBefore(cid, args.beforeMessageId, args.limit); break;
            case 'getMessagesAfter': result = await platform.getMessagesAfter(cid, args.afterMessageId, args.limit); break;
            case 'getMessagesAround': result = await platform.getMessagesAround(cid, args.aroundMessageId, args.limit); break;
            case 'getMessageById': result = await platform.getMessageById(cid, args.messageId); break;
            case 'getLastMessageByUser': result = await platform.getLastMessageByUser(cid, targetUid); break;
            case 'searchStoredMessages': result = await platform.searchStoredMessages(gid, cid, args.query, args.limit, args.fromDate, args.toDate); break;


            case 'getMemberById': result = await platform.getMemberById(gid, targetUid); break;
            case 'getMemberByName': result = await platform.getMemberByName(gid, args.name); break;
            case 'locateUser':
            case 'findUserLocation': result = await platform.findUserLocation(gid, args.userId); break;
            case 'listMembers': {
                const rawLimit = Number.isInteger(args.limit) ? args.limit : parseInt(args.limit, 10);
                const rawOffset = Number.isInteger(args.offset) ? args.offset : parseInt(args.offset, 10);
                const safeLimit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 50, 50));
                const safeOffset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);
                result = await platform.listMembers(gid, safeLimit, safeOffset);
                break;
            }



            case 'addRoleToMember': result = await platform.addRoleToMember(gid, args.userId, args.roleId, args.reason); break;
            case 'removeRoleFromMember': result = await platform.removeRoleFromMember(gid, args.userId, args.roleId, args.reason); break;
            case 'setMemberRoles': result = await platform.setMemberRoles(gid, args.userId, args.roleIds, args.reason); break;

            case 'deleteMessage': result = await platform.deleteMessage(cid, args.messageId, args.reason); break;
            case 'bulkDeleteMessages': result = await platform.bulkDeleteMessages(cid, args.count, args.reason); break;
            case 'timeoutMember': result = await platform.timeoutMember(gid, args.userId, args.durationMs, args.reason); break;
            case 'removeTimeout': result = await platform.removeTimeout(gid, args.userId, args.reason); break;
            case 'banMember': result = await platform.banMember(gid, args.userId, args.reason, args.deleteMessageSeconds); break;
            case 'unbanMember': result = await platform.unbanMember(gid, args.userId, args.reason); break;

            case 'sendMessage': {
                if (args.userId && (!cid || cid === context.channelId)) {
                    // Smart delivery: Go to user, like playMusic
                    result = await platform.sendMessageToUser(gid, args.userId, args.content);
                } else {
                    // Standard delivery: specific channel
                    result = await platform.sendMessage(cid, args.content);
                }
                break;
            }
            case 'replyToMessage': result = await platform.replyToMessage(cid, args.messageId, args.content); break;
            case 'sendAnnouncement': result = await platform.sendAnnouncement(cid, args.title, args.body, args.fields, args.footer); break;

            case 'searchWeb': result = await platform.searchWeb(args.query, args.maxResults, args.safeSearch); break;

            case 'getUserProfile': result = await platform.getUserProfile(gid, targetUid); break;
            case 'setUserProfile': result = await platform.setUserProfile(gid, targetUid, args.timezone, args.language, args.personaPreference); break;
            case 'getUserMemory': result = await platform.getUserMemory(gid, targetUid, args.key); break;
            case 'setUserMemory': result = await platform.setUserMemory(gid, targetUid, args.key, args.valueJson, args.source, args.confidence, args.expiresAt); break;
            case 'clearUserMemory': result = await platform.clearUserMemory(gid, targetUid, args.key); break;



            case 'createReminder': result = await platform.createReminder(gid, targetUid, cid, args.remindAt, args.message); break;
            case 'listUserReminders': result = await platform.listUserReminders(gid, targetUid, args.status, args.limit); break;
            case 'cancelReminder': result = await platform.cancelReminder(args.reminderId, args.reason); break;




            case 'getAiStats': {
                const { getRateLimiter } = require("./rate_limiter");
                const rateLimiter = getRateLimiter();
                result = rateLimiter.getStats();
                break;
            }
            case 'playMusic': result = await platform.playMusic(context.guildId, context.userId, context.channelId, args.query, args.targetUserId, args.source); break;
            case 'controlMusic': {
                if (args.action === 'stop') result = await platform.stopMusic(context.guildId);
                else if (args.action === 'skip') result = await platform.skipMusic(context.guildId);
                else result = await platform.pauseMusic(context.guildId);
                break;
            }

            default:
                logger.warn(`Tool not found in dispatcher: ${name}`);
                return { error: `Tool ${name} is not implemented in dispatcher.` };
        }

        // Log the invocation for audit
        if (platform.logToolInvocation && context.sessionId) {
            await platform.logToolInvocation(
                context.guildId,
                context.channelId,
                context.userId,
                context.sessionId,
                name,
                args,
                result
            );
        }

        return result;
    } catch (error) {
        logger.error(`Error executing tool '${name}' (Guild: ${context.guildId}, Channel: ${context.channelId}, User: ${context.userId}): ${error.message}`, error);
        return { error: `Execution failed for tool '${name}': ${error.message}` };
    }
}

/**
 * Handles multiple tool calls from an AI message.
 */
async function handleToolCalls(toolCalls, context = {}) {
    const results = [];
    for (const toolCall of toolCalls) {
        const { id, function: fn } = toolCall;
        const args = parseToolArguments(fn.arguments, fn.name);
        const output = await callTool(fn.name, args, context);

        results.push({
            tool_call_id: id,
            role: "tool",
            name: fn.name,
            content: typeof output === 'string' ? output : JSON.stringify(output)
        });
    }
    return results;
}

module.exports = {
    callTool,
    handleToolCalls
};
