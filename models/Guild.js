const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const Guild = sequelize.define("Guild", {
    guild_id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
    },
    name: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    audio_engine: {
        type: DataTypes.ENUM("lavalink"),
        defaultValue: "lavalink",
        allowNull: false,
    }
}, {
    timestamps: true,
    underscored: true,
});

module.exports = Guild;
