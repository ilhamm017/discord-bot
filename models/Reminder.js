const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const Reminder = sequelize.define("Reminder", {
    reminder_id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
    },
    guild_id: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    user_id: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    channel_id: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    message: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    remind_at: {
        type: DataTypes.DATE,
        allowNull: false,
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: "scheduled",
        comment: "scheduled/sent/cancelled/failed",
    },
}, {
    timestamps: true,
    underscored: true,
    indexes: [
        {
            name: "idx_reminders_due",
            fields: ["status", "remind_at"],
        },
        {
            name: "idx_reminders_user",
            fields: ["guild_id", "user_id", "remind_at"],
        },
    ],
});

module.exports = Reminder;
