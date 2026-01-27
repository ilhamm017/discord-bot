const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const Session = sequelize.define("Session", {
    session_id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
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
    last_entity_type: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "member, message, topic",
    },
    last_entity_id: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    state_json: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
}, {
    timestamps: true,
    underscored: true,
    indexes: [
        {
            name: "idx_sessions_guild_channel_user",
            fields: ["guild_id", "channel_id", "user_id"],
        },
        {
            name: "idx_sessions_updated",
            fields: ["updated_at"],
        },
    ],
});

module.exports = Session;
