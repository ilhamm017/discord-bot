# Wiring Flow Map (Yova)

## Startup + Bootstrap
- `index.js` bootstraps: `storage/sequelize.connectDB` then `discord.start`.
- `discord/client.js` loads commands from `discord/tools/*/*.js` into `client.commands`.
- `discord/client.js` loads events from `discord/events/*.js` and registers listeners.
- `discord/events/ready.js` logs the ready state after login.

## Message (text) flow
- `discord/events/messageCreate.js` filters bots, checks prefix, and extracts args.
- Known command -> `client.commands.get(name).execute(message, args)`.
- Unknown command or reply-to-bot -> `utils/ai/ai_chat.handleAiRequest`.
- AI replies are sent via `utils/common/typing.waitWithTyping` then `message.reply`.

## AI router (chat) flow
- `utils/ai/ai_chat.js` handles call-name, memory extraction, summary checks, and bot docs locally.
- Router LLM call uses `ai/completion.chatCompletion` with server context + history.
- Allowed commands for routing come from `message.client.commands` with fallback `AI_COMMANDS_FALLBACK`.
- Router parse -> command executes via `messageCreate` or fallback `generateAiReply`.

## AI command implementations
- `discord/tools/ai/ringkas.js` -> `functions/tools/ai/summarization.generateSummary` -> `ai/completion.chatCompletion`.
- `discord/tools/ai/ucapkan.js` -> `functions/tools/ai/message_generation.generateAiMessage` -> `ai/completion.chatCompletion`.
- `discord/tools/ai/member.js` + `cek.js` -> `functions/tools/member_logic`.
- `discord/tools/ai/panggil.js`, `jelaskan.js`, `rangkum.js` are local/alias handling.

## General/moderation commands
- `discord/tools/general/memberinfo.js` -> `functions/platform/identity_logic.getMemberById`.
- `discord/tools/general/addrole.js`/`removerole.js` -> `functions/platform/identity_logic` role ops.
- `discord/tools/general/timeout.js`/`ban.js` -> `functions/platform/identity_logic` moderation ops.
- `discord/tools/general/ping.js` replies locally (no external calls).

## Music commands + interactions
- `discord/tools/music/*` call `discord/player/queue.js` and helpers in `discord/player/queue/*`.
- `discord/tools/music/play.js` routes to Spotify/YouTube handlers and uses `utils/common/spotify` + `utils/common/ytdlp`.
- `discord/events/interactionCreate.js` handles `music_*` buttons and calls queue controls.
- `discord/player/panel.js` renders/updates the control panel message.

## Platform tool-calling stack (currently not wired to chat)
- `ai/controller.js` runs tool-capable agent via `ai/completion`.
- `ai/tool_definitions.js` defines tool schemas (chat, identity, moderation, messaging, web, memory, session, reminders, audit).
- `ai/tool_handler.js` dispatches tool calls to `functions/platform/*` and logs via `logToolInvocation`.
- `functions/platform/index.js` re-exports `chat_logic`, `identity_logic`, `core_logic`, `policy_logic`.

## Platform logic map
- `functions/platform/chat_logic.js` wraps Discord message fetch/send and message DB indexing.
- `functions/platform/identity_logic.js` wraps member, role, and moderation API calls.
- `functions/platform/core_logic.js` covers web search, profiles/memory, sessions, reminders, audit logs.
- `functions/platform/policy_logic.js` provides permission checks for tool calls.

## Storage + data
- `storage/sequelize.js` handles DB init; used by `index.js`.
- `storage/db.js` stores call names, AI memory entries, and queue state.
- `models/*` define Sequelize tables for platform logic (`Message`, `Member`, `Reminder`, `ToolInvocation`, etc.).
- `.data/` is used for yt-dlp cache and local storage; `logs/` for runtime logs.
