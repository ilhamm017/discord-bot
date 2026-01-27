const { DataTypes } = require("sequelize");
const { sequelize } = require("../storage/sequelize");

const Role = sequelize.define("Role", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    guild_id: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    role_id: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    name: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    position: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
}, {
    timestamps: true,
    underscored: true,
    indexes: [
        {
            name: "idx_roles_guild_role",
            unique: true,
            fields: ["guild_id", "role_id"],
        },
        {
            name: "idx_roles_guild_name",
            fields: ["guild_id", "name"],
        },
    ],
});

module.exports = Role;
