const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const UserMemoryKV = sequelize.define("UserMemoryKV", {
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
    key: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    value_json: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    source: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "user / admin / inferred",
    },
    confidence: {
        type: DataTypes.FLOAT,
        defaultValue: 1.0,
    },
    expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
}, {
    tableName: "user_memory_kv",
    timestamps: true,
    underscored: true,
    indexes: [
        {
            unique: true,
            fields: ["guild_id", "user_id", "key"],
            name: "idx_usermemorykv_unique",
        },
        {
            name: "idx_memory_guild_user",
            fields: ["guild_id", "user_id"],
        },
        {
            name: "idx_memory_expires",
            fields: ["expires_at"],
        },
    ],
});

module.exports = UserMemoryKV;
