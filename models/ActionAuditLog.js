const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const ActionAuditLog = sequelize.define("ActionAuditLog", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    guild_id: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    channel_id: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    actor_user_id: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    action_type: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: "DELETE_MESSAGE, ADD_ROLE, TIMEOUT, etc",
    },
    target_user_id: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    target_message_id: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    request_json: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    result_json: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    status: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "success/denied/failed",
    },
    reason: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
}, {
    tableName: "action_audit_logs",
    timestamps: true,
    underscored: true,
    indexes: [
        {
            name: "idx_audit_guild_time",
            fields: ["guild_id", "created_at"],
        },
        {
            name: "idx_audit_actor_time",
            fields: ["guild_id", "actor_user_id", "created_at"],
        },
        {
            name: "idx_audit_action_time",
            fields: ["guild_id", "action_type", "created_at"],
        },
    ],
});

module.exports = ActionAuditLog;
