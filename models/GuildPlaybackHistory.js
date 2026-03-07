const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const GuildPlaybackHistory = sequelize.define("GuildPlaybackHistory", {
    guildId: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true,
    },
    historyJson: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: "[]",
    },
}, {
    indexes: [
        {
            unique: true,
            fields: ["guildId"],
        },
    ],
});

module.exports = GuildPlaybackHistory;
