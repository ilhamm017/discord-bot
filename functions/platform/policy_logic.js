const { client } = require("../../discord/client");
const logger = require("../../utils/logger");
const { PermissionsBitField } = require("discord.js");

/**
 * J. Permission / Policy (middleware internal)
 */

/**
 * J1. Check User Permission
 * Tujuan: memvalidasi apakah user boleh menjalankan aksi tertentu.
 */
async function checkUserPermission(guildId, userId, actionType) {
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);

        // Map action types to Discord permissions
        const permissionMap = {
            'DELETE_MESSAGE': PermissionsBitField.Flags.ManageMessages,
            'BULK_DELETE': PermissionsBitField.Flags.ManageMessages,
            'TIMEOUT_MEMBER': PermissionsBitField.Flags.ModerateMembers,
            'BAN_MEMBER': PermissionsBitField.Flags.BanMembers,
            'UNBAN_MEMBER': PermissionsBitField.Flags.BanMembers,
            'ADD_ROLE': PermissionsBitField.Flags.ManageRoles,
            'REMOVE_ROLE': PermissionsBitField.Flags.ManageRoles,
            'SET_ROLES': PermissionsBitField.Flags.ManageRoles,
            'ANNOUNCEMENT': PermissionsBitField.Flags.MentionEveryone // Example
        };

        const requiredPermission = permissionMap[actionType];

        // If no specific permission mapped, assume it's a general user action or needs custom logic
        if (!requiredPermission) {
            return { allowed: true, reason: "No specific permission required" };
        }

        if (member.permissions.has(requiredPermission)) {
            return { allowed: true };
        } else {
            return { allowed: false, reason: `Missing permission: ${actionType}` };
        }
    } catch (error) {
        logger.error(`Error in checkUserPermission: ${error.message}`);
        return { allowed: false, reason: "Error checking permissions" };
    }
}

/**
 * J2. Validate Tool Invocation
 * Tujuan: mengamankan tool invocation agar argumen valid.
 */
function validateToolInvocation(toolName, args, context) {
    const errors = [];

    // Basic validation logic
    if (!toolName) errors.push("Tool name is missing");
    if (typeof args !== 'object') errors.push("Arguments must be an object");

    // Example specific tool validation
    if (toolName === 'sendMessage' && (!args.content || args.content.length === 0)) {
        errors.push("Message content cannot be empty");
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

module.exports = {
    checkUserPermission,
    validateToolInvocation
};
