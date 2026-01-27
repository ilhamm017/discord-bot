const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const Member = sequelize.define("Member", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    guild_id: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    user_id: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    username: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    display_name: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    is_bot: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    joined_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    last_seen_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
}, {
    timestamps: true,
    underscored: true,
    indexes: [
        {
            name: "idx_members_guild_user",
            unique: true,
            fields: ["guild_id", "user_id"],
        },
        {
            name: "idx_members_guild_display",
            fields: ["guild_id", "display_name"],
        },
        {
            name: "idx_members_guild_username",
            fields: ["guild_id", "username"],
        },
        {
            name: "idx_members_guild_lastseen",
            fields: ["guild_id", "last_seen_at"],
        },
    ],
});

module.exports = Member;
