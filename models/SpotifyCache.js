const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const SpotifyCache = sequelize.define("SpotifyCache", {
    spotifyId: {
        type: DataTypes.STRING,
        primaryKey: true,
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    artists: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    durationMs: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    youtubeUrl: {
        type: DataTypes.STRING,
        allowNull: false,
    },
});

module.exports = SpotifyCache;
