const {
  createAudioPlayer,
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
} = require("@discordjs/voice");
const logger = require("../../utils/logger");

const guildStates = new Map();

function cleanupGuild(guildId) {
  const state = guildStates.get(guildId);
  if (!state) return false;

  try {
    state.player.stop(true);
  } catch (error) {
    logger.warn(`Failed stopping player for guild ${guildId}.`, error);
  }

  try {
    state.connection.destroy();
  } catch (error) {
    logger.warn(`Failed destroying connection for guild ${guildId}.`, error);
  }

  guildStates.delete(guildId);
  return true;
}

async function connectToVoice(channel) {
  const guildId = channel.guild.id;
  let state = guildStates.get(guildId);

  if (state && state.channelId !== channel.id) {
    cleanupGuild(guildId);
    state = null;
  }

  if (!state) {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    const player = createAudioPlayer();

    connection.subscribe(player);

    state = { connection, player, channelId: channel.id };
    guildStates.set(guildId, state);

    connection.on(VoiceConnectionStatus.Disconnected, () => {
      cleanupGuild(guildId);
    });

    player.on("error", (error) => {
      logger.error(`Audio player error in guild ${guildId}.`, error);
    });
  }

  try {
    await entersState(state.connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (error) {
    cleanupGuild(guildId);
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
};
