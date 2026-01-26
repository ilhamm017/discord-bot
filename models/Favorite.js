const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const Favorite = sequelize.define("Favorite", {
    userId: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true,
    },
    videoId: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true,
    },
    url: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    playCount: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
    },
    lastPlayedAt: {
        type: DataTypes.DATE, // Sequelize handles DATE as timestamp
        defaultValue: DataTypes.NOW,
    },
});

module.exports = Favorite;
