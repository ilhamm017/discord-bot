
const { getInfoWithYtDlp } = require("./utils/common/ytdlp");

async function test() {
    const url = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM3M";
    try {
        console.log("Fetching info for:", url);
        const info = await getInfoWithYtDlp(url);
        console.log("Type:", info._type);
        console.log("Title:", info.title);
        if (info.entries) {
            console.log("Entries count:", info.entries.length);
            console.log("First Entry:", info.entries[0].title, "by", info.entries[0].artist);
        } else {
            console.log("No entries found (single track?)");
            console.log("Track:", info.title, "by", info.artist);
        }
    } catch (error) {
        console.error("Yt-dlp Spotify Info Error:", error.message);
        if (error.cause) console.error("Cause:", error.cause.message);
    }
}

test();
