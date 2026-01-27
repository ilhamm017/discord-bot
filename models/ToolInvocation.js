const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const ToolInvocation = sequelize.define("ToolInvocation", {
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
        allowNull: false,
    },
    user_id: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    session_id: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    tool_name: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    arguments_json: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    tool_result_json: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    model_name: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    latency_ms: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    token_in: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    token_out: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
}, {
    timestamps: true,
    underscored: true,
    indexes: [
        {
            name: "idx_toolinv_session_time",
            fields: ["session_id", "created_at"],
        },
        {
            name: "idx_toolinv_tool_time",
            fields: ["tool_name", "created_at"],
        },
        {
            name: "idx_toolinv_guild_time",
            fields: ["guild_id", "created_at"],
        },
    ],
});

module.exports = ToolInvocation;
