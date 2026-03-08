"use strict";

function getErrorText(error) {
    const parts = [];
    const push = (value) => {
        if (!value) return;
        const text = String(value).trim();
        if (text) parts.push(text);
    };

    let current = error;
    let depth = 0;
    while (current && depth < 4) {
        push(current.message);
        push(current.stderr);
        push(current.stdout);
        push(current.details?.stderr);
        push(current.details?.stdout);
        current = current.cause;
        depth += 1;
    }

    return parts.join("\n");
}

function isYoutubeCookiesError(error) {
    const text = getErrorText(error);
    return /cookies are no longer valid|sign in to confirm you(?:'|’)re not a bot|cookies?.*(expired|invalid|rotated)|authentication/i.test(text);
}

function isYoutubeSearchInfraError(error) {
    const text = getErrorText(error);
    return /YTDLP_SEARCH_FAILED|YTDLP_DOWNLOAD_FAILED|browseId|youtube search failed|no tracks found via lavalink/i.test(text);
}

function getYoutubeUserFacingError(error, { spotify = false } = {}) {
    if (isYoutubeCookiesError(error)) {
        return spotify
            ? "Gagal memetakan lagu Spotify karena cookies YouTube bermasalah atau sudah expired. Upload ulang cookies YouTube di panel web."
            : "Gagal memutar dari YouTube karena cookies YouTube bermasalah atau sudah expired. Upload ulang cookies YouTube di panel web.";
    }

    if (isYoutubeSearchInfraError(error)) {
        return spotify
            ? "Gagal memetakan lagu Spotify ke YouTube saat ini. Coba judul lain atau cek lagi cookies YouTube."
            : "Gagal mencari atau memutar hasil YouTube saat ini. Coba judul lain atau cek lagi cookies YouTube.";
    }

    return null;
}

module.exports = {
    getErrorText,
    getYoutubeUserFacingError,
    isYoutubeCookiesError,
    isYoutubeSearchInfraError,
};
