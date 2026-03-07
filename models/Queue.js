const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const QueueState = sequelize.define("QueueState", {
    guildId: {
        type: DataTypes.STRING,
        primaryKey: true,
    },
    currentIndex: {
        type: DataTypes.INTEGER,
        defaultValue: -1,
    },
    repeatMode: {
        type: DataTypes.STRING,
        defaultValue: "off",
    },
    engine: {
        type: DataTypes.STRING,
        defaultValue: "lavalink",
    },
});

const QueueItem = sequelize.define("QueueItem", {
    guildId: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    position: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    url: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    requestedById: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    requestedByTag: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    metadataJson: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
});

module.exports = { QueueState, QueueItem };
