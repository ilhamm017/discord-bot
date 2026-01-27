const { client } = require("../../discord/client");
const { Member: MemberModel, Role: RoleModel, MemberRole: MemberRoleModel, Message: MessageModel } = require("../../models");
const logger = require("../../utils/logger");

/**
 * B. Member & Role (Read-only + Action)
 */

/**
 * B1. Get member by id
 */
async function getMemberById(guildId, userId) {
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        return {
            userId: member.id,
            username: member.user.username,
            displayName: member.displayName,
            isBot: member.user.bot,
            joinedAt: member.joinedAt,
            roles: member.roles.cache.map(r => r.id)
        };
    } catch (error) {
        logger.error(`Error in getMemberById: ${error.message}`);
        return null;
    }
}

/**
 * B2. Get member by name (username/nickname, fuzzy ringan)
 */
async function getMemberByName(guildId, name) {
    try {
        const guild = await client.guilds.fetch(guildId);
        const members = await guild.members.fetch();
        const search = name.toLowerCase();
        const filtered = members.filter(m =>
            m.user.username.toLowerCase().includes(search) ||
            m.displayName.toLowerCase().includes(search)
        );
        return filtered.map(m => ({
            userId: m.id,
            displayName: m.displayName,
            username: m.user.username
        }));
    } catch (error) {
        logger.error(`Error in getMemberByName: ${error.message}`);
        return [];
    }
}

/**
 * B3. List members (dibatasi, untuk admin/debug)
 */
async function listMembers(guildId, limit = 50, offset = 0) {
    try {
        const guild = await client.guilds.fetch(guildId);
        const safeLimit = Math.max(1, Math.min(Number.isInteger(limit) ? limit : 50, 50));
        const safeOffset = Math.max(0, Number.isInteger(offset) ? offset : 0);

        let members;
        if (safeOffset === 0) {
            members = await guild.members.fetch({ limit: safeLimit });
        } else if (guild.memberCount && guild.members.cache.size >= guild.memberCount) {
            members = guild.members.cache;
        } else {
            members = await guild.members.fetch();
        }

        const list = Array.from(members.values()).map(m => ({
            userId: m.id,
            displayName: m.displayName
        }));

        return {
            items: list.slice(safeOffset, safeOffset + safeLimit),
            total: typeof guild.memberCount === 'number' ? guild.memberCount : list.length,
            offset: safeOffset,
            limit: safeLimit
        };
    } catch (error) {
        logger.error(`Error in listMembers: ${error.message}`);
        return { items: [], total: 0, offset: 0, limit: 0 };
    }
}

/**
 * B4. Update “last seen”
 */
async function updateMemberLastSeen(guildId, userId, lastSeenAt = new Date()) {
    try {
        await MemberModel.upsert({
            guild_id: guildId,
            user_id: userId,
            last_seen_at: lastSeenAt
        });
        return { updated: true };
    } catch (error) {
        logger.error(`Error in updateMemberLastSeen: ${error.message}`);
        return { updated: false };
    }
}

/**
 * B5. Sinkron role dari Discord ke DB
 */
async function syncMemberRolesFromDiscord(guildId, userId) {
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        const roleIds = member.roles.cache.map(r => r.id);

        // Update MemberRole table
        await MemberRoleModel.destroy({ where: { guild_id: guildId, user_id: userId } });
        const items = roleIds.map(rid => ({
            guild_id: guildId,
            user_id: userId,
            role_id: rid,
            assigned_at: new Date()
        }));
        await MemberRoleModel.bulkCreate(items);

        return { roles: roleIds };
    } catch (error) {
        logger.error(`Error in syncMemberRolesFromDiscord: ${error.message}`);
        return { roles: [] };
    }
}

/**
 * B6. Add / remove / set role (ACTION)
 */
async function addRoleToMember(guildId, userId, roleId, reason = "") {
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        await member.roles.add(roleId, reason);
        return { success: true };
    } catch (error) {
        logger.error(`Error in addRoleToMember: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function removeRoleFromMember(guildId, userId, roleId, reason = "") {
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        await member.roles.remove(roleId, reason);
        return { success: true };
    } catch (error) {
        logger.error(`Error in removeRoleFromMember: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function setMemberRoles(guildId, userId, roleIds, reason = "") {
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        await member.roles.set(roleIds, reason);
        return { success: true, roles: roleIds };
    } catch (error) {
        logger.error(`Error in setMemberRoles: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * C. Moderation (Action — high risk)
 */

/**
 * C1. Delete 1 message
 */
async function deleteMessage(channelId, messageId, reason = "") {
    try {
        const channel = await client.channels.fetch(channelId);
        const msg = await channel.messages.fetch(messageId);
        await msg.delete({ reason });
        return { deleted: true };
    } catch (error) {
        logger.error(`Error in deleteMessage: ${error.message}`);
        return { deleted: false };
    }
}

/**
 * C2. Bulk delete
 */
async function bulkDeleteMessages(channelId, count, reason = "") {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel.isTextBased() || !channel.bulkDelete) throw new Error("Not a text channel");
        const deleted = await channel.bulkDelete(Math.min(count, 100), true);
        return { deletedCount: deleted.size };
    } catch (error) {
        logger.error(`Error in bulkDeleteMessages: ${error.message}`);
        return { deletedCount: 0 };
    }
}

/**
 * C3. Timeout member
 */
async function timeoutMember(guildId, userId, durationMs, reason = "") {
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        await member.timeout(durationMs, reason);
        return { timedOut: true, until: new Date(Date.now() + durationMs) };
    } catch (error) {
        logger.error(`Error in timeoutMember: ${error.message}`);
        return { timedOut: false };
    }
}

/**
 * C4. Remove timeout
 */
async function removeTimeout(guildId, userId, reason = "") {
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        await member.timeout(null, reason);
        return { timedOut: false };
    } catch (error) {
        logger.error(`Error in removeTimeout: ${error.message}`);
        return { timedOut: true };
    }
}

/**
 * C5. Ban / unban
 */
async function banMember(guildId, userId, reason = "", deleteMessageSeconds = 0) {
    try {
        const guild = await client.guilds.fetch(guildId);
        await guild.members.ban(userId, { reason, deleteMessageSeconds });
        return { banned: true };
    } catch (error) {
        logger.error(`Error in banMember: ${error.message}`);
        return { banned: false };
    }
}

async function unbanMember(guildId, userId, reason = "") {
    try {
        const guild = await client.guilds.fetch(guildId);
        await guild.members.unban(userId, reason);
        return { banned: false };
    } catch (error) {
        logger.error(`Error in unbanMember: ${error.message}`);
        return { banned: true };
    }
}

/**
 * B7. Get role by name
 */
async function getRoleByName(guildId, roleName) {
    try {
        const guild = await client.guilds.fetch(guildId);
        const roles = await guild.roles.fetch();
        const search = roleName.toLowerCase();
        return roles.find(r => r.name.toLowerCase() === search || r.id === roleName);
    } catch (error) {
        logger.error(`Error in getRoleByName: ${error.message}`);
        return null;
    }
}

/**
 * B8. Find user location (voice and text)
 */
async function findUserLocation(guildId, userIdOrNameRaw) {
    try {
        const guild = await client.guilds.fetch(guildId);
        let member;

        // Clean mention syntax if present: <@123...> or <@!123...> -> 123...
        let userIdOrName = String(userIdOrNameRaw || "").replace(/[<@!>]/g, "").trim();

        // Normalize "fancy" unicode text (e.g. 𝚂𝓮𝓷𝓷 -> Senn)
        const normalizeText = (text) => String(text || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const search = normalizeText(userIdOrName);

        // Try direct ID fetch first
        if (/^\d+$/.test(userIdOrName)) {
            try {
                member = await guild.members.fetch(userIdOrName);
            } catch (e) {
                // If ID fetch fails, maybe it's a name that looks like an ID or user is gone
            }
        }

        // If no member found by ID, try searching by name (Fuzzy fallback)
        if (!member) {
            const members = await guild.members.fetch();
            member = members.find(m => {
                const uname = normalizeText(m.user.username);
                const dname = normalizeText(m.displayName);
                const tag = normalizeText(m.user.tag);
                return uname === search || dname === search || tag === search;
            });

            // Second level: includes check
            if (!member) {
                member = members.find(m => {
                    const uname = normalizeText(m.user.username);
                    const dname = normalizeText(m.displayName);
                    return uname.includes(search) || dname.includes(search);
                });
            }
        }

        if (!member) {
            return { error: `User "${userIdOrName}" tidak ditemukan di server ini.` };
        }

        const userId = member.id;
        const result = {
            userId: userId,
            displayName: member.displayName,
            voice: null,
            text: null
        };

        // 1. Check Voice Channel (Real-time)
        const voiceChannel = member.voice.channel;
        if (voiceChannel) {
            result.voice = {
                channelId: voiceChannel.id,
                channelName: voiceChannel.name
            };
        }

        // 2. Check Last Text Channel (From Database)
        const lastMessage = await MessageModel.findOne({
            where: { guild_id: guildId, author_user_id: userId },
            order: [['created_at_discord', 'DESC']]
        });

        if (lastMessage) {
            let channelName = "unknown-channel";
            try {
                const channel = await guild.channels.fetch(lastMessage.channel_id);
                channelName = channel.name;
            } catch (e) {
                // Channel might be deleted or inaccessible
            }
            result.text = {
                channelId: lastMessage.channel_id,
                channelName: channelName,
                lastSeen: lastMessage.created_at_discord
            };
        }

        if (!result.voice && !result.text) {
            return {
                type: 'none',
                ...result,
                message: "User tidak ditemukan di Voice Channel dan tidak punya riwayat pesan."
            };
        }

        // Add a "delivery recommendation"
        let locationDescription = "NONE";
        let targetChannelId = null;

        if (result.voice) {
            locationDescription = `User berada di Voice Channel "${result.voice.channelName}" (bisa chat di sana).`;
            targetChannelId = result.voice.channelId;
        } else if (result.text) {
            locationDescription = `User terakhir aktif di text channel #${result.text.channelName}.`;
            targetChannelId = result.text.channelId;
        }

        return {
            type: result.voice ? 'voice' : 'text-fallback',
            ...result,
            locationDescription,
            suggestedChannelId: targetChannelId
        };
    } catch (error) {
        logger.error(`Error in findUserLocation: ${error.message}`);
        return { error: error.message };
    }
}

module.exports = {
    getMemberById,
    getMemberByName,
    listMembers,
    updateMemberLastSeen,
    syncMemberRolesFromDiscord,
    addRoleToMember,
    removeRoleFromMember,
    setMemberRoles,
    getRoleByName,
    deleteMessage,
    bulkDeleteMessages,
    timeoutMember,
    removeTimeout,
    banMember,
    unbanMember,
    findUserLocation
};
