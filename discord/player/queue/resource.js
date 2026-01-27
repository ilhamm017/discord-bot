const {
    StreamType,
    createAudioResource,
    demuxProbe,
} = require("@discordjs/voice");
const play = require("play-dl");
const { getInfoWithYtDlp, streamWithYtDlp } = require("../../../utils/common/ytdlp");
const logger = require("../../../utils/logger");

async function getTrackInfo(track) {
    if (track.info) {
        if (!track.title) {
            track.title = track.info.video_details?.title || track.url;
        }
        return track.info;
    }

    if (!track.url) {
        throw new Error("Missing track URL");
    }

    try {
        const info = await play.video_basic_info(track.url);
        track.info = info;

        if (!track.title) {
            track.title = info.video_details?.title || track.url;
        }

        return info;
    } catch (error) {
        let fallbackInfo = null;
        try {
            const data = await getInfoWithYtDlp(track.url);
            if (data) {
                const thumbnails = Array.isArray(data.thumbnails)
                    ? data.thumbnails
                        .map((thumb) => ({
                            url: thumb?.url,
                            width: thumb?.width,
                            height: thumb?.height,
                        }))
                        .filter((thumb) => thumb.url)
                    : [];
                if (!thumbnails.length && data.thumbnail) {
                    thumbnails.push({ url: data.thumbnail });
                }
                fallbackInfo = {
                    video_details: {
                        title: data.title || track.url,
                        url: data.webpage_url || data.original_url || track.url,
                        durationInSec: Number.isFinite(data.duration) ? data.duration : null,
                        thumbnails,
                    },
                };
            }
        } catch (fallbackError) {
            logger.warn("Failed fetching track info, continuing without metadata.", {
                url: track.url,
                error,
            });
            logger.debug("yt-dlp metadata fallback failed.", {
                url: track.url,
                error: fallbackError,
            });
        }

        if (fallbackInfo) {
            track.info = fallbackInfo;
            if (!track.title) {
                track.title = fallbackInfo.video_details?.title || track.url;
            }
            return fallbackInfo;
        }

        if (!track.title) {
            track.title = track.url;
        }
        return null;
    }
}

function ensureValidTrackUrl(track) {
    if (!track?.url || typeof track.url !== "string") {
        throw new Error("Invalid track URL");
    }

    if (play.yt_validate(track.url) !== "video") {
        throw new Error("Invalid track URL");
    }
}

async function createResource(track) {
    ensureValidTrackUrl(track);
    await getTrackInfo(track);

    try {
        const fallbackStream = await streamWithYtDlp(track.url);

        try {
            const probe = await demuxProbe(fallbackStream);
            return createAudioResource(probe.stream, { inputType: probe.type });
        } catch (probeError) {
            fallbackStream.destroy();
        }

        fallbackStream = await streamWithYtDlp(track.url);
        return createAudioResource(fallbackStream, {
            inputType: StreamType.Arbitrary,
        });
    } catch (error) {
        if (error?.message === "YTDLP_DOWNLOAD_FAILED") {
            throw error;
        }

        const message = String(error?.message || "");
        const wrapped = new Error(
            message.toLowerCase().includes("ffmpeg")
                ? "STREAM_NEEDS_FFMPEG"
                : "STREAM_FALLBACK_FAILED"
        );
        wrapped.cause = error;
        throw wrapped;
    }
}

module.exports = {
    getTrackInfo,
    createResource,
};
