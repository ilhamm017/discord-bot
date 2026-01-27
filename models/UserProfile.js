const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const UserProfile = sequelize.define("UserProfile", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    guild_id: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    user_id: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    timezone: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    language: {
        type: DataTypes.STRING,
        defaultValue: "id",
    },
    persona_preference: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
}, {
    timestamps: true,
    underscored: true,
    indexes: [
        {
            unique: true,
            fields: ["guild_id", "user_id"],
            name: "idx_userprofiles_guild_user",
        },
    ],
});

module.exports = UserProfile;
