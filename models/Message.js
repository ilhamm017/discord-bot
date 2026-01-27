const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const Message = sequelize.define("Message", {
    message_id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
    },
    guild_id: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    channel_id: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    author_user_id: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    content: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    created_at_discord: {
        type: DataTypes.DATE,
        allowNull: false,
    },
    edited_at_discord: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    has_attachments: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    reply_to_message_id: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    metadata_json: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "JSON string for embeds, etc",
    },
}, {
    timestamps: true,
    underscored: true,
    indexes: [
        {
            name: "idx_messages_channel_time",
            fields: ["channel_id", "created_at_discord"],
        },
        {
            name: "idx_messages_guild_author_time",
            fields: ["guild_id", "author_user_id", "created_at_discord"],
        },
    ],
});

module.exports = Message;
