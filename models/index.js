const Guild = require("./Guild");
const Channel = require("./Channel");
const Member = require("./Member");
const Role = require("./Role");
const MemberRole = require("./MemberRole");
const Message = require("./Message");
const UserProfile = require("./UserProfile");
const UserMemoryKV = require("./UserMemoryKV");
const MemoryEvent = require("./MemoryEvent");
const Session = require("./Session");
const Reminder = require("./Reminder");
const ActionAuditLog = require("./ActionAuditLog");
const ToolInvocation = require("./ToolInvocation");

// Existing models
const Favorite = require("./Favorite");
const { QueueState, QueueItem } = require("./Queue");
const SpotifyCache = require("./SpotifyCache");
const User = require("./User");
const UserMemory = require("./UserMemory");
const UserQueueHistory = require("./UserQueueHistory");
const GuildPlaybackHistory = require("./GuildPlaybackHistory");
const ElevenLabsUsage = require("./ElevenLabsUsage");

// Associations
Guild.hasMany(Channel, { foreignKey: "guild_id" });
Channel.belongsTo(Guild, { foreignKey: "guild_id" });

Guild.hasMany(Member, { foreignKey: "guild_id" });
Member.belongsTo(Guild, { foreignKey: "guild_id" });

Guild.hasMany(Role, { foreignKey: "guild_id" });
Role.belongsTo(Guild, { foreignKey: "guild_id" });

// Music Associations
QueueState.hasMany(QueueItem, { foreignKey: "guildId", sourceKey: "guildId" });
QueueItem.belongsTo(QueueState, { foreignKey: "guildId", targetKey: "guildId" });

// Member ↔ Role (Many-to-Many via MemberRole)
// ...

module.exports = {
    Guild,
    Channel,
    Member,
    Role,
    MemberRole,
    Message,
    UserProfile,
    UserMemoryKV,
    MemoryEvent,
    Session,
    Reminder,
    ActionAuditLog,
    ToolInvocation,
    Favorite,
    QueueState,
    QueueItem,
    SpotifyCache,
    User,
    UserMemory,
    UserQueueHistory,
    GuildPlaybackHistory,
    ElevenLabsUsage,
};
