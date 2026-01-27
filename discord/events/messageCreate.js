const logger = require("../../utils/logger");
const { handleDiscordMessage } = require("../../functions/adapters/discord");
let config = {};
try {
    config = require("../../config.json");
} catch (error) {
    config = {};
}
const { prefix = "!" } = config;

module.exports = {
    name: "messageCreate",
    async execute(message) {
        if (message.author.bot) return;
        if (!message?.id) return;

        // Deduplicate in case the event fires twice or handlers are double-registered
        if (!global.__yovaProcessedMessages) {
            global.__yovaProcessedMessages = new Map();
        }
        const processed = global.__yovaProcessedMessages;
        const now = Date.now();
        const seenAt = processed.get(message.id);
        if (seenAt && now - seenAt < 60_000) {
            logger.warn("Duplicate message suppressed.", {
                messageId: message.id,
                channelId: message.channel?.id || null,
                guildId: message.guild?.id || null,
                authorId: message.author?.id || null
            });
            return;
        }
        processed.set(message.id, now);

        const client = message.client;
        const content = message.content.trim();
        const prefixLower = prefix.toLowerCase();

        // Helper to interface with the new Adapter
        const runAiPrompt = async (prompt, source = "chat", options = {}) => {
            if (!prompt) return;
            try {
                logger.info("Universal AI request", {
                    authorId: message.author.id,
                    channelId: message.channel.id,
                    guildId: message.guild?.id || null,
                    source,
                });

                // Delegate to the new Universal AI Adapter
                await handleDiscordMessage(message, prompt, options);

            } catch (error) {
                logger.error("AI chat error", error);
                await message.reply("Gagal menjawab dengan AI. Coba lagi nanti.");
            }
        };

        // 1. Check for command prefix
        const startsWithPrefix = content.toLowerCase().startsWith(prefixLower);

        if (!startsWithPrefix) {
            // 2. Check for Replies (Self-Ref logic)
            if (message.reference?.messageId && content) {
                try {
                    const referenced = await message.fetchReference();
                    // If replying to ME (the bot)
                    if (referenced?.author?.id === client.user.id) {
                        const replyContext = referenced.content?.trim() || "";
                        await runAiPrompt(content, "reply", { replyContext });
                    }
                } catch (error) {
                    logger.warn("Failed to resolve reply reference.", error);
                }
            }
            // If just normal chat without prefix/reply, Ignore.
            return;
        }

        // 3. Process Command
        const rest = content.slice(prefix.length);

        // Prevent "! " trigger (space after prefix)
        if (rest.length) {
            const needsBoundary = /[a-z0-9]$/i.test(prefix);
            if (needsBoundary && !/^\s/.test(rest)) return;
        }

        const args = rest.trim().split(/\s+/).filter(Boolean);
        const commandName = args.shift()?.toLowerCase();
        if (!commandName) return;

        // 4. Execute Command
        const command = client.commands.get(commandName);
        if (!command) {
            // Fallback: If command not found, treat as AI prompt
            const prompt = rest.trim();
            await runAiPrompt(prompt, "unknown_command");
            return;
        }

        try {
            await command.execute(message, args);
        } catch (error) {
            logger.error(
                `Command ${commandName} error (guild ${message.guild?.id || "dm"})`,
                error
            );
            await message.reply("Terjadi error saat menjalankan perintah.");
        }
    },
};
