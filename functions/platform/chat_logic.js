const { client } = require("../../discord/client");
const { Message: MessageModel } = require("../../models");
const logger = require("../../utils/logger");
const { EmbedBuilder } = require("discord.js");
const { Op } = require("sequelize");

/**
 * A. Chat & Message (Read-only / Discord.js)
 */

/**
 * A1. Ambil pesan terbaru
 * Tujuan: konteks percakapan, “apa yang dibahas barusan”.
 */
async function getRecentMessages(channelId, limit = 20) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) return [];

        const messages = await channel.messages.fetch({ limit });
        return messages.map(msg => ({
            messageId: msg.id,
            authorUserId: msg.author.id,
            content: msg.content,
            createdAt: msg.createdAt
        }));
    } catch (error) {
        logger.error(`Error in getRecentMessages (ID: ${channelId}): ${error.message}`);
        return [];
    }
}

/**
 * A2. Ambil pesan sebelum/after/around (pagination)
 */
async function getMessagesBefore(channelId, beforeMessageId, limit = 20) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) return [];
        const messages = await channel.messages.fetch({ before: beforeMessageId, limit });
        return messages.map(msg => ({ messageId: msg.id, authorUserId: msg.author.id, content: msg.content, createdAt: msg.createdAt }));
    } catch (error) {
        logger.error(`Error in getMessagesBefore: ${error.message}`);
        return [];
    }
}

async function getMessagesAfter(channelId, afterMessageId, limit = 20) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) return [];
        const messages = await channel.messages.fetch({ after: afterMessageId, limit });
        return messages.map(msg => ({ messageId: msg.id, authorUserId: msg.author.id, content: msg.content, createdAt: msg.createdAt }));
    } catch (error) {
        logger.error(`Error in getMessagesAfter: ${error.message}`);
        return [];
    }
}

async function getMessagesAround(channelId, aroundMessageId, limit = 20) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) return [];
        const messages = await channel.messages.fetch({ around: aroundMessageId, limit });
        return messages.map(msg => ({ messageId: msg.id, authorUserId: msg.author.id, content: msg.content, createdAt: msg.createdAt }));
    } catch (error) {
        logger.error(`Error in getMessagesAround: ${error.message}`);
        return [];
    }
}

/**
 * A3. Ambil 1 pesan spesifik
 */
async function getMessageById(channelId, messageId) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) return null;
        const msg = await channel.messages.fetch(messageId);
        return {
            messageId: msg.id,
            authorUserId: msg.author.id,
            content: msg.content,
            createdAt: msg.createdAt,
            editedAt: msg.editedAt,
            replyToMessageId: msg.reference?.messageId || null,
            hasAttachments: msg.attachments.size > 0
        };
    } catch (error) {
        logger.error(`Error in getMessageById: ${error.message}`);
        return null;
    }
}

/**
 * A4. Ambil pesan terakhir user di channel
 */
async function getLastMessageByUser(channelId, userId) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) return null;
        const messages = await channel.messages.fetch({ limit: 50 });
        const userMsg = messages.find(m => m.author.id === userId);
        if (!userMsg) return null;
        return { messageId: userMsg.id, content: userMsg.content, createdAt: userMsg.createdAt };
    } catch (error) {
        logger.error(`Error in getLastMessageByUser (ID: ${channelId}): ${error.message}`);
        return null;
    }
}

/**
 * A5. Cari chat historis di DB
 */
async function searchStoredMessages(guildId, channelId = null, query, limit = 20, fromDate = null, toDate = null) {
    try {
        const where = {
            guild_id: guildId,
            content: { [Op.like]: `%${query}%` }
        };
        if (channelId) where.channel_id = channelId;
        if (fromDate || toDate) {
            where.created_at_discord = {};
            if (fromDate) where.created_at_discord[Op.gte] = new Date(fromDate);
            if (toDate) where.created_at_discord[Op.lte] = new Date(toDate);
        }

        const msgs = await MessageModel.findAll({
            where,
            order: [['created_at_discord', 'DESC']],
            limit
        });

        return msgs.map(m => ({
            messageId: m.message_id,
            authorUserId: m.author_user_id,
            content: m.content,
            createdAt: m.created_at_discord
        }));
    } catch (error) {
        logger.error(`Error in searchStoredMessages: ${error.message}`);
        return [];
    }
}

/**
 * A6. Simpan message ke DB (untuk indexing)
 */
async function storeMessage(message) {
    try {
        await MessageModel.upsert({
            message_id: message.messageId,
            guild_id: message.guildId,
            channel_id: message.channelId,
            author_user_id: message.authorUserId,
            content: message.content,
            created_at_discord: message.createdAtDiscord,
            edited_at_discord: message.editedAtDiscord || null,
            has_attachments: !!message.hasAttachments,
            reply_to_message_id: message.replyToMessageId || null,
            metadata_json: message.metadataJson || null
        });
        return { stored: true };
    } catch (error) {
        logger.error(`Error in storeMessage: ${error.message}`);
        return { stored: false };
    }
}

/**
 * D. Bot Messaging / Announcements (Action)
 */

/**
 * D1. Send message to specific channel
 */
async function sendMessage(channelId, content) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) throw new Error("Invalid channel");
        const msg = await channel.send(content);
        return { messageId: msg.id };
    } catch (error) {
        logger.error(`Error in sendMessage: ${error.message}`);
        return null;
    }
}

/**
 * D1b. Send smart message to user (Auto-tracking)
 * Mimics playMusic logic: finds where user is and sends there.
 */
async function sendMessageToUser(guildId, userIdOrName, content) {
    try {
        // Reuse identity logic to find the best channel
        const { findUserLocation } = require("./identity_logic");
        const location = await findUserLocation(guildId, userIdOrName);

        if (location.error) return location;

        const targetChannelId = location.suggestedChannelId;
        if (!targetChannelId) {
            return { error: `Gak tau nih si ${userIdOrName} lagi di mana...` };
        }

        const result = await sendMessage(targetChannelId, content);
        if (result) {
            return {
                success: true,
                messageId: result.messageId,
                channelId: targetChannelId,
                locationType: location.type,
                status: `Message sent to channel ${location.suggestedChannelId} (${location.type})`
            };
        }
        return { error: "Gagal ngirim pesan, channel-nya kayaknya terkunci." };
    } catch (error) {
        logger.error(`Error in sendMessageToUser: ${error.message}`);
        return { error: error.message };
    }
}

/**
 * D2. Reply to message
 */
async function replyToMessage(channelId, messageId, content) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) throw new Error("Invalid channel");
        const msg = await channel.messages.fetch(messageId);
        const reply = await msg.reply(content);
        return { messageId: reply.id };
    } catch (error) {
        logger.error(`Error in replyToMessage: ${error.message}`);
        return null;
    }
}

/**
 * D3. Announcement (embed-like)
 */
async function sendAnnouncement(channelId, title, body, fields = [], footer = null) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) throw new Error("Invalid channel");

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(body)
            .setColor(0x00AE86);

        if (fields.length > 0) embed.addFields(fields);
        if (footer) embed.setFooter({ text: footer });

        const msg = await channel.send({ embeds: [embed] });
        return { messageId: msg.id };
    } catch (error) {
        logger.error(`Error in sendAnnouncement: ${error.message}`);
        return null;
    }
}

/**
 * On-demand music status
 */
async function getMusicStatus(guildId) {
    try {
        const { buildMusicContext } = require("../../utils/ai/ai_chat");
        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
        if (!guild) return { error: "Guild not found." };

        // Mock message for existing functions
        const mockMsg = { guild };
        const result = await buildMusicContext(mockMsg);
        return result;
    } catch (error) {
        logger.error(`Error in getMusicStatus: ${error.message}`);
        return { error: error.message };
    }
}

/**
 * On-demand server info
 */
async function getServerInfo(guildId, channelId, userId) {
    try {
        const { buildServerContext } = require("../../utils/ai/ai_chat");
        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
        if (!guild) return { error: "Guild not found." };
        const channel = guild.channels.cache.get(channelId);
        const member = guild.members.cache.get(userId);

        const mockMsg = {
            guild,
            channel,
            member,
            mentions: { members: new Map(), users: new Map() }
        };
        const result = await buildServerContext(mockMsg);
        return result;
    } catch (error) {
        logger.error(`Error in getServerInfo: ${error.message}`);
        return { error: error.message };
    }
}

module.exports = {
    getRecentMessages,
    getMessagesBefore,
    getMessagesAfter,
    getMessagesAround,
    getMessageById,
    getLastMessageByUser,
    searchStoredMessages,
    storeMessage,
    sendMessage,
    sendMessageToUser,
    replyToMessage,
    sendAnnouncement,
    getMusicStatus,
    getServerInfo
};
