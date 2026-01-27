const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const Channel = sequelize.define("Channel", {
    channel_id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
    },
    guild_id: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    name: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    type: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "text/thread/voice",
    },
    is_indexed: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
}, {
    timestamps: true,
    underscored: true,
    indexes: [
        {
            name: "idx_channels_guild",
            fields: ["guild_id"],
        },
        {
            name: "idx_channels_guild_indexed",
            fields: ["guild_id", "is_indexed"],
        },
    ],
});

module.exports = Channel;
