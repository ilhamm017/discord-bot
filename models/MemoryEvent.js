const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const MemoryEvent = sequelize.define("MemoryEvent", {
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
    old_value_json: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    new_value_json: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    reason: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
}, {
    timestamps: true,
    underscored: true,
    indexes: [
        {
            name: "idx_memoryevents_guild_user_time",
            fields: ["guild_id", "user_id", "created_at"],
        },
    ],
});

module.exports = MemoryEvent;
