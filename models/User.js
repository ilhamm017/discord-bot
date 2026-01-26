const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const User = sequelize.define("User", {
    id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
        comment: "Discord User ID",
    },
    username: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    xp: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
    },
    points: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
    },
    callName: {
        type: DataTypes.STRING,
        allowNull: true,
    },
});

module.exports = User;
