const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const ElevenLabsUsage = sequelize.define("ElevenLabsUsage", {
    usageMonth: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true,
    },
    characterCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    requestCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    lastUsedAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
}, {
    indexes: [
        {
            unique: true,
            fields: ["usageMonth"],
        },
    ],
});

module.exports = ElevenLabsUsage;
