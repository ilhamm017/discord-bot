const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const UserMemory = sequelize.define("UserMemory", {
    userId: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true,
    },
    kind: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true,
    },
    value: {
        type: DataTypes.TEXT,
        allowNull: false,
        primaryKey: true,
    },
}, {
    timestamps: true,
    createdAt: false, // We only care about updated_at which sequelize gives by default
});

module.exports = UserMemory;
