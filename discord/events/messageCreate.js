const logger = require("../../utils/logger");
const { handleAiRequest } = require("../../utils/ai/ai_chat");
const { waitWithTyping } = require("../../utils/common/typing");
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

        const client = message.client;
        const content = message.content.trim();
        const prefixLower = prefix.toLowerCase();

        const runAiPrompt = async (prompt, source = "chat") => {
            if (!prompt) return;
            try {
                logger.info("AI chat request", {
                    authorId: message.author.id,
                    channelId: message.channel.id,
                    guildId: message.guild?.id || null,
                    source,
                });
                const aiResult = await handleAiRequest(message, prompt);
                if (aiResult?.type === "command" && aiResult.name) {
                    const aiCommand = client.commands.get(aiResult.name);
                    if (!aiCommand) {
                        await message.reply("Perintah itu belum tersedia.");
                        return;
                    }
                    logger.info("AI routed command", {
                        command: aiResult.name,
                        authorId: message.author.id,
                        channelId: message.channel.id,
                        guildId: message.guild?.id || null,
                        source,
                    });
                    await aiCommand.execute(message, aiResult.args || []);
                    return;
                }

                const reply = aiResult?.message?.trim();
                if (reply) {
                    await waitWithTyping(message.channel, reply);
                    await message.reply(reply);
                } else {
                    await message.reply("Nggak paham maksudnya.");
                }
            } catch (error) {
                logger.error("AI chat error", error);
                await message.reply("Gagal menjawab dengan AI. Coba lagi nanti.");
            }
        };

        const startsWithPrefix = content.toLowerCase().startsWith(prefixLower);
        if (!startsWithPrefix) {
            if (message.reference?.messageId && content) {
                try {
                    const referenced = await message.fetchReference();
                    if (referenced?.author?.id === client.user.id) {
                        await runAiPrompt(content, "reply");
                    }
                } catch (error) {
                    logger.warn("Failed to resolve reply reference.", error);
                }
            }
            return;
        }

        const rest = content.slice(prefix.length);
        if (rest.length) {
            const needsBoundary = /[a-z0-9]$/i.test(prefix);
            if (needsBoundary && !/^\s/.test(rest)) return;
        }

        const args = rest.trim().split(/\s+/).filter(Boolean);
        const commandName = args.shift()?.toLowerCase();
        if (!commandName) return;

        const command = client.commands.get(commandName);
        if (!command) {
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
