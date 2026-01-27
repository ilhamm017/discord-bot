const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const UserQueueHistory = sequelize.define("UserQueueHistory", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    queueJson: {
        type: DataTypes.TEXT, // Storing full queue as JSON for easy restore
        allowNull: false,
    },
    currentIndex: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
    },
}, {
    indexes: [
        {
            unique: true,
            fields: ['userId', 'guildId']
        }
    ]
});

module.exports = UserQueueHistory;
