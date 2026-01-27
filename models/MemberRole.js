const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const MemberRole = sequelize.define("MemberRole", {
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
    role_id: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    assigned_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
}, {
    timestamps: true,
    underscored: true,
    indexes: [
        {
            name: "idx_memberroles_guild_user",
            fields: ["guild_id", "user_id"],
        },
        {
            name: "idx_memberroles_guild_role",
            fields: ["guild_id", "role_id"],
        },
    ],
    // Add unique constraint across guild_id, user_id, role_id
    validate: {
        // Handled by unique index usually, but let's define it in table options if possible or just use indexes
    }
}, {
    // Correct way for multi-column unique in sequelize define options:
    indexes: [
        {
            unique: true,
            fields: ['guild_id', 'user_id', 'role_id'],
            name: 'unique_member_role'
        }
    ]
});

// Redefining to ensure correct structure
const MemberRoleExport = sequelize.define("MemberRole", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    guild_id: { type: DataTypes.STRING, allowNull: false },
    user_id: { type: DataTypes.STRING, allowNull: false },
    role_id: { type: DataTypes.STRING, allowNull: false },
    assigned_at: { type: DataTypes.DATE, allowNull: true },
}, {
    timestamps: true,
    underscored: true,
    indexes: [
        { unique: true, fields: ["guild_id", "user_id", "role_id"], name: "idx_memberroles_unique" },
        { fields: ["guild_id", "user_id"], name: "idx_memberroles_guild_user" },
        { fields: ["guild_id", "role_id"], name: "idx_memberroles_guild_role" },
    ]
});

module.exports = MemberRoleExport;
