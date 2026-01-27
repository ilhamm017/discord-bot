const tools = [
    // --- Group A: Chat & Message ---
    {
        type: "function",
        function: {
            name: "getRecentMessages",
            description: "Fetch the most recent messages from a Discord text channel. Use this when the user asks about recent discussions, activity, or needs chat context. Do not use this if the question can be answered without reading message history.",
            parameters: {
                type: "object",
                properties: {
                    channelId: { type: "string", description: "Discord channel ID. Omit to use the current channel." },
                    limit: { type: "integer", description: "Maximum number of items to return.", default: 20 }
                }
            },
            tags: ["discord_message"]
        }
    },
    {
        type: "function",
        function: {
            name: "getMessagesBefore",
            description: "Fetch messages immediately before a specific message ID for context. Use when a user references a message and needs what came before it. Do not use for general history searches or summaries.",
            parameters: {
                type: "object",
                properties: {
                    channelId: { type: "string", description: "Discord channel ID. Omit for auto-injection." },
                    beforeMessageId: { type: "string", description: "Reference message ID; fetch messages before this." },
                    limit: { type: "integer", description: "Maximum number of items to return.", default: 20 }
                },
                required: ["beforeMessageId"]
            },
            tags: ["discord_message"]
        }
    },
    {
        type: "function",
        function: {
            name: "getMessagesAfter",
            description: "Fetch messages immediately after a specific message ID for context. Use when a user asks what happened after a referenced message. Do not use for general history searches or summaries.",
            parameters: {
                type: "object",
                properties: {
                    channelId: { type: "string", description: "Discord channel ID. Omit for auto-injection." },
                    afterMessageId: { type: "string", description: "Reference message ID; fetch messages after this." },
                    limit: { type: "integer", description: "Maximum number of items to return.", default: 20 }
                },
                required: ["afterMessageId"]
            },
            tags: ["discord_message"]
        }
    },
    {
        type: "function",
        function: {
            name: "getMessagesAround",
            description: "Fetch messages surrounding a specific message ID (before and after). Use when you need nearby context for a cited message. Do not use for broad history or keyword search.",
            parameters: {
                type: "object",
                properties: {
                    channelId: { type: "string", description: "Discord channel ID. Omit for auto-injection." },
                    aroundMessageId: { type: "string", description: "Reference message ID; fetch messages around this." },
                    limit: { type: "integer", default: 20, description: "Total messages to fetch" }
                },
                required: ["aroundMessageId"]
            },
            tags: ["discord_message"]
        }
    },
    {
        type: "function",
        function: {
            name: "getMessageById",
            description: "Fetch a single message by its ID. Use when the user provides a specific message ID or link. Do not use to search for messages or infer context.",
            parameters: {
                type: "object",
                properties: {
                    channelId: { type: "string", description: "Discord channel ID. Omit for auto-injection." },
                    messageId: { type: "string", description: "Discord message ID." }
                },
                required: ["messageId"]
            },
            tags: ["discord_message"]
        }
    },
    {
        type: "function",
        function: {
            name: "getLastMessageByUser",
            description: "Fetch the most recent message from a specific user in a channel. Use when asked what someone last said. Do not use for multi-user summaries or general context.",
            parameters: {
                type: "object",
                properties: {
                    channelId: { type: "string", description: "Discord channel ID. Omit to use the current channel." },
                    userId: { type: "string", description: "Discord user ID. Optional if referring to the current user." }
                },
                required: []
            },
            tags: ["discord_message"]
        }
    },
    {
        type: "function",
        function: {
            name: "searchStoredMessages",
            description: "Search indexed historical messages in the database. Use for keyword-based lookups across time. Do not use for live context if recent messages can be fetched, and avoid if history is not required.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. Omit for auto-injection." },
                    channelId: { type: "string", description: "Optional channel filter" },
                    query: { type: "string", description: "The text to search for" },
                    limit: { type: "integer", description: "Maximum number of items to return.", default: 20 },
                    fromDate: { type: "string", description: "ISO date string for start range" },
                    toDate: { type: "string", description: "ISO date string for end range" }
                },
                required: ["query"]
            },
            tags: ["discord_message"]
        }
    },

    // --- Group B: Member & Role ---
    {
        type: "function",
        function: {
            name: "getMemberById",
            description: "Fetch member information by user ID. Use when you need member details to answer or perform an action. Do not use if the user ID is unknown or the info is unnecessary.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. DO NOT GUESS. Omit for auto-injection." },
                    userId: { type: "string", description: "Discord user ID. Optional if referring to the current user/author." }
                },
                required: []
            },
            tags: ["discord_member"]
        }
    },
    {
        type: "function",
        function: {
            name: "getMemberByName",
            description: "Search members by username or display name (fuzzy). Use when the user provides a name but no ID. Do not use when the exact user ID is already known.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. DO NOT GUESS. Omit for auto-injection." },
                    name: { type: "string", description: "Username or display name to search for." }
                },
                required: ["name"]
            },
            tags: ["discord_member"]
        }
    },
    {
        type: "function",
        function: {
            name: "listMembers",
            description: "List members of a guild with pagination. Use only when the user asks for a list or bulk processing. Do not use for single-member lookups.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. Omit for auto-injection." },
                    limit: { type: "integer", description: "Maximum number of items to return.", default: 50 },
                    offset: { type: "integer", description: "Pagination offset.", default: 0 }
                },
                required: []
            },
            tags: ["discord_member"]
        }
    },
    {
        type: "function",
        function: {
            name: "locateUser",
            description: "Cari tahu posisi member ada di mana (Voice Channel mana, atau channel teks terakhir dia aktif). Gunakan jika user tanya 'X di mana?' atau 'Cari si X'.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. DO NOT GUESS. Omit for auto-injection." },
                    userId: { type: "string", description: "Discord user ID atau nama orang yang mau dicari." }
                },
                required: ["userId"]
            },
            tags: ["discord_member", "social"]
        }
    },


    {
        type: "function",
        function: {
            name: "addRoleToMember",
            description: "Add a role to a member. Use only when explicitly requested and permissions are confirmed. Do not use for hypotheticals or suggestions.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. Omit for auto-injection." },
                    userId: { type: "string", description: "Discord user ID. Omit for auto-injection." },
                    roleId: { type: "string", description: "Discord role ID." },
                    reason: { type: "string", description: "Reason for this action (optional)." }
                },
                required: ["roleId"]
            },
            tags: ["discord_member"]
        }
    },
    {
        type: "function",
        function: {
            name: "removeRoleFromMember",
            description: "Remove a role from a member. Use only when explicitly requested and permissions are confirmed. Do not use for hypotheticals or suggestions.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. Omit for auto-injection." },
                    userId: { type: "string", description: "Discord user ID. Omit for auto-injection." },
                    roleId: { type: "string", description: "Discord role ID." },
                    reason: { type: "string", description: "Reason for this action (optional)." }
                },
                required: ["roleId"]
            },
            tags: ["discord_member"]
        }
    },
    {
        type: "function",
        function: {
            name: "setMemberRoles",
            description: "Replace all roles for a member with the provided list. Use only when explicitly asked to set/replace roles (destructive). Do not use to add or remove a single role.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. Omit for auto-injection." },
                    userId: { type: "string", description: "Discord user ID. Omit for auto-injection." },
                    roleIds: { type: "array", description: "List of role IDs to set (replaces existing roles).", items: { type: "string" } },
                    reason: { type: "string", description: "Reason for this action (optional)." }
                },
                required: ["roleIds"]
            },
            tags: ["discord_member"]
        }
    },
    // --- Group C: Moderation ---
    {
        type: "function",
        function: {
            name: "deleteMessage",
            description: "Delete a specific message. Use only for explicit moderation requests with a target message ID. Do not use without confirmation.",
            parameters: {
                type: "object",
                properties: {
                    channelId: { type: "string", description: "Discord channel ID. Omit for auto-injection." },
                    messageId: { type: "string", description: "Discord message ID." },
                    reason: { type: "string", description: "Reason for this action (optional)." }
                },
                required: ["messageId"]
            },
            tags: ["discord_moderation"]
        }
    },
    {
        type: "function",
        function: {
            name: "bulkDeleteMessages",
            description: "Bulk delete a number of recent messages in a channel. Use only when the user explicitly asks to delete N recent messages. Do not use to target specific content or as a search delete.",
            parameters: {
                type: "object",
                properties: {
                    channelId: { type: "string", description: "Discord channel ID. Omit for auto-injection." },
                    count: { type: "integer", description: "Number of messages to delete.", minimum: 2, maximum: 100 },
                    reason: { type: "string", description: "Reason for this action (optional)." }
                },
                required: ["count"]
            },
            tags: ["discord_moderation"]
        }
    },
    {
        type: "function",
        function: {
            name: "timeoutMember",
            description: "Timeout/mute a member for a duration. Use only with an explicit moderation request and a duration. Do not use for warnings or hypotheticals.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. Omit for auto-injection." },
                    userId: { type: "string", description: "Discord user ID. Omit for auto-injection." },
                    durationMs: { type: "integer", description: "Duration in milliseconds" },
                    reason: { type: "string", description: "Reason for this action (optional)." }
                },
                required: ["durationMs"]
            },
            tags: ["discord_moderation"]
        }
    },
    {
        type: "function",
        function: {
            name: "removeTimeout",
            description: "Remove an active timeout from a member. Use only when explicitly requested to lift a timeout. Do not use as part of a warning.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. Omit for auto-injection." },
                    userId: { type: "string", description: "Discord user ID. Omit for auto-injection." },
                    reason: { type: "string", description: "Reason for this action (optional)." }
                },
                required: []
            },
            tags: ["discord_moderation"]
        }
    },
    {
        type: "function",
        function: {
            name: "banMember",
            description: "Ban a member from the guild. Use only with an explicit moderation request and confirmation. Do not use for threats or examples.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. Omit for auto-injection." },
                    userId: { type: "string", description: "Discord user ID. Omit for auto-injection." },
                    reason: { type: "string", description: "Reason for this action (optional)." },
                    deleteMessageSeconds: { type: "integer", default: 0, description: "Delete messages from the user within this timeframe" }
                },
                required: []
            },
            tags: ["discord_moderation"]
        }
    },
    {
        type: "function",
        function: {
            name: "unbanMember",
            description: "Unban a member from the guild. Use only when explicitly requested to unban. Do not use for policy explanations.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. Omit for auto-injection." },
                    userId: { type: "string", description: "Discord user ID. Omit for auto-injection." },
                    reason: { type: "string", description: "Reason for this action (optional)." }
                },
                required: []
            },
            tags: ["discord_moderation"]
        }
    },
    // --- Group D: Bot Messaging ---
    {
        type: "function",
        function: {
            name: "sendMessage",
            description: "Send a message. You can target a specific channel OR a specific user (to deliver it where they are, like playMusic).",
            parameters: {
                type: "object",
                properties: {
                    channelId: { type: "string", description: "Optional: Target channel ID." },
                    userId: { type: "string", description: "Optional: Target user ID to deliver the message to their location." },
                    content: { type: "string", description: "The message text to send." }
                },
                required: ["content"]
            },
            tags: ["discord_messaging"]
        }
    },
    {
        type: "function",
        function: {
            name: "replyToMessage",
            description: "Reply to a specific message. Use when the user explicitly wants a reply to a given message ID. You can reply across channels if you know the channelId and messageId.",
            parameters: {
                type: "object",
                properties: {
                    channelId: { type: "string", description: "Discord channel ID. Omit for auto-injection." },
                    messageId: { type: "string", description: "Discord message ID." },
                    content: { type: "string", description: "Message content text." }
                },
                required: ["messageId", "content"]
            },
            tags: ["discord_messaging"]
        }
    },
    {
        type: "function",
        function: {
            name: "sendAnnouncement",
            description: "Send a formatted announcement embed. Use only when the user asks for an announcement format. Do not use for simple messages.",
            parameters: {
                type: "object",
                properties: {
                    channelId: { type: "string", description: "Discord channel ID. Omit for auto-injection." },
                    title: { type: "string", description: "Announcement title." },
                    body: { type: "string", description: "Announcement body text." },
                    fields: {
                        type: "array",
                        description: "Optional embed fields.",
                        items: {
                            type: "object",
                            properties: {
                                name: { type: "string", description: "Embed field title." },
                                value: { type: "string", description: "Embed field value text." },
                                inline: { type: "boolean", description: "Whether to display the field inline." }
                            },
                            required: ["name", "value"]
                        }
                    },
                    footer: { type: "string", description: "Footer text." }
                },
                required: ["title", "body"]
            },
            tags: ["discord_messaging"]
        }
    },
    // --- Group E: Search ---
    {
        type: "function",
        function: {
            name: "searchWeb",
            description: "Search the public web for real-time information, current events, financial data (crypto/stocks), or general knowledge. Use this when the user asks for 'latest', 'current', or 'trending' info.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search query text." },
                    maxResults: { type: "integer", description: "Maximum number of results to return.", default: 3 },
                    safeSearch: { type: "integer", description: "Safe search level (0=off, 1=moderate, 2=strict).", default: 1 }
                },
                required: ["query"]
            },
            tags: ["web"]
        }
    },
    // --- Group F: User Memory & Profiles ---
    {
        type: "function",
        function: {
            name: "getUserProfile",
            description: "Retrieve a user's stored profile/preferences. Use when personalization is needed. Do not use if the data is not required.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. Omit for auto-injection." },
                    userId: { type: "string", description: "Discord user ID. Omit for auto-injection." }
                },
                required: []
            },
            tags: ["memory"]
        }
    },
    {
        type: "function",
        function: {
            name: "setUserProfile",
            description: "Update a user's profile/preferences. Use only when the user explicitly states a preference or requests a change. Do not infer or overwrite without consent.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. Omit for auto-injection." },
                    userId: { type: "string", description: "Discord user ID. Omit for auto-injection." },
                    timezone: { type: "string", description: "Preferred timezone (IANA name, e.g. Asia/Jakarta)." },
                    language: { type: "string", description: "Preferred language code." },
                    personaPreference: { type: "string", description: "Preferred persona/style identifier." }
                },
                required: []
            },
            tags: ["memory"]
        }
    },
    {
        type: "function",
        function: {
            name: "getUserMemory",
            description: "Retrieve stored memories for a user. Use when you need saved facts to answer. Do not use for general browsing.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. Omit for auto-injection." },
                    userId: { type: "string", description: "Discord user ID. Omit for auto-injection." },
                    key: { type: "string", description: "Optional key filter" }
                },
                required: []
            },
            tags: ["memory"]
        }
    },
    {
        type: "function",
        function: {
            name: "setUserMemory",
            description: "Store a memory about a user. Use only for stable, user-provided facts with consent. Do not store sensitive info or guesses.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. Omit for auto-injection." },
                    userId: { type: "string", description: "Discord user ID. Omit for auto-injection." },
                    key: { type: "string", description: "Memory key." },
                    valueJson: { type: "string", description: "Value as JSON string" },
                    source: { type: "string", description: "Source of this information (e.g. 'chat')" },
                    confidence: { type: "number", description: "Confidence score between 0 and 1.", minimum: 0, maximum: 1 },
                    expiresAt: { type: "string", description: "ISO date string" }
                },
                required: ["key", "valueJson"]
            },
            tags: ["memory"]
        }
    },
    {
        type: "function",
        function: {
            name: "clearUserMemory",
            description: "Clear specific or all memories for a user. Use only when the user explicitly asks to forget or reset. Do not use for routine cleanup.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. Omit for auto-injection." },
                    userId: { type: "string", description: "Discord user ID. Omit for auto-injection." },
                    key: { type: "string", description: "Optional key to clear specific memory" }
                },
                required: []
            },
            tags: ["memory"]
        }
    },
    // --- Group G: Session Management ---

    // --- Group H: Reminders ---
    {
        type: "function",
        function: {
            name: "createReminder",
            description: "Create a reminder for a user. Use only when the user explicitly asks for a reminder with a time. Do not guess times.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. Omit for auto-injection." },
                    userId: { type: "string", description: "Discord user ID. Omit for auto-injection." },
                    channelId: { type: "string", description: "Discord channel ID. Omit for auto-injection." },
                    remindAt: { type: "string", description: "ISO date/time string" },
                    message: { type: "string", description: "Reminder message text to send." }
                },
                required: ["remindAt", "message"]
            },
            tags: ["reminder"]
        }
    },
    {
        type: "function",
        function: {
            name: "listUserReminders",
            description: "List a user's reminders. Use when the user asks to view reminders. Do not use by default.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild (server) ID. Omit for auto-injection." },
                    userId: { type: "string", description: "Discord user ID. Omit for auto-injection." },
                    status: { type: "string", description: "Filter reminders by status.", enum: ["pending", "completed", "cancelled"] },
                    limit: { type: "integer", description: "Maximum number of items to return.", default: 10 }
                },
                required: []
            },
            tags: ["reminder"]
        }
    },
    {
        type: "function",
        function: {
            name: "cancelReminder",
            description: "Cancel a pending reminder. Use only when the user explicitly requests cancellation. Do not cancel automatically.",
            parameters: {
                type: "object",
                properties: {
                    reminderId: { type: "string", description: "Reminder identifier." },
                    reason: { type: "string", description: "Reason for this action (optional)." }
                },
                required: ["reminderId"]
            },
            tags: ["reminder"]
        }
    },

    // --- Group I: Logging & Audit ---

    {
        type: "function",
        function: {
            name: "getAiStats",
            description: "Retrieve real-time AI performance statistics, including token usage (TPM), queue status, and rate limiting metrics. Use this when the user asks about AI health, limits, or performance.",
            parameters: {
                type: "object",
                properties: {
                    includeHistory: { type: "boolean", description: "Whether to include detailed history of recent usage.", default: false }
                }
            },
            tags: ["system"]
        }
    },
    // --- Group J: Music ---
    {
        type: "function",
        function: {
            name: "playMusic",
            description: "Search and play music from YouTube. Use this when the user asks to play a song, audio, or music. You can target a specific user to play it where they are.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "The song title or URL to search and play." },
                    targetUserId: { type: "string", description: "Optional: User ID to play the music for (at their location)." }
                },
                required: ["query"]
            },
            tags: ["music"]
        }
    },
    {
        type: "function",
        function: {
            name: "controlMusic",
            description: "Control music playback actions like stop, skip, or pause.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["stop", "skip", "pause", "resume"],
                        description: "The action to perform on current music playback."
                    }
                },
                required: ["action"]
            },
            tags: ["music"]
        }
    },
    {
        type: "function",
        function: {
            name: "getMusicStatus",
            description: "Dapatkan status musik yang sedang diputar, lagu sekarang, antrian (queue), dan mode repeat. Gunakan jika user tanya 'Lagi putar apa?', 'Cek antrian', atau status musik.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild ID. Omit for auto-injection." }
                }
            },
            tags: ["music"]
        }
    },
    {
        type: "function",
        function: {
            name: "getServerInfo",
            description: "Dapatkan informasi server seperti nama server, jumlah member, nama channel, dan daftar role. Gunakan jika user tanya detail tentang server/channel ini.",
            parameters: {
                type: "object",
                properties: {
                    guildId: { type: "string", description: "Discord guild ID. Omit for auto-injection." }
                }
            },
            tags: ["system", "discord_member"]
        }
    }
];

module.exports = tools;
