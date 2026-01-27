const {
  createAudioPlayer,
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
} = require("@discordjs/voice");
const logger = require("../../utils/logger");

const guildStates = new Map();

function getOrCreateState(guildId) {
  let state = guildStates.get(guildId);
  if (!state) {
    state = {
      queue: [],
      currentIndex: -1,
      repeatMode: "off",
      engine: null, // Will be set by PlayerManager
    };
    guildStates.set(guildId, state);
  }
  return state;
}

function cleanupGuild(guildId) {
  const state = guildStates.get(guildId);
  if (!state) return false;

  if (state.player) {
    try {
      state.player.stop(true);
    } catch (error) {
      logger.warn(`Failed stopping player for guild ${guildId}.`, error);
    }
  }

  if (state.connection) {
    try {
      state.connection.destroy();
    } catch (error) {
      logger.warn(`Failed destroying connection for guild ${guildId}.`, error);
    }
    state.connection = null;
  }

  // NOTE: We don't delete from guildStates here anymore to keep the queue in memory
  // but we can mark it as disconnected if needed.
  // Actually, delete it ONLY if we want total cleanup.
  // Let's keep it for now but be careful.
  // If the user said "bot leaves and queue is empty", it's because this was deleted.
  // We want to keep the queue!

  // guildStates.delete(guildId); 
  return true;
}

async function connectToVoice(channel) {
  const guildId = channel.guild.id;
  let state = getOrCreateState(guildId);

  // If already connected to a DIFFERENT channel, clean up connection (but keep state)
  if (state.connection && state.channelId !== channel.id) {
    try { state.connection.destroy(); } catch (e) { }
    state.connection = null;
  }

  if (!state.connection) {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    if (!state.player) {
      state.player = createAudioPlayer();
    }

    connection.subscribe(state.player);

    state.connection = connection;
    state.channelId = channel.id;

    connection.on(VoiceConnectionStatus.Disconnected, () => {
      // Only cleanup if it's a real disconnect, not an engine switch
      // For now, let's keep it simple.
      state.connection = null;
    });

    state.player.on("error", (error) => {
      logger.error(`Audio player error in guild ${guildId}.`, error);
    });
  }

  try {
    await entersState(state.connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (error) {
    state.connection?.destroy();
    state.connection = null;
    throw error;
  }

  return state;
}

function getGuildState(guildId) {
  return guildStates.get(guildId);
}

module.exports = {
  cleanupGuild,
  connectToVoice,
  getGuildState,
  getOrCreateState,
};
