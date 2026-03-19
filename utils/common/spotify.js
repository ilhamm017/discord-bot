const SPOTIFY_URI_REGEX = /spotify:(track|playlist|album):([a-zA-Z0-9]+)/i;
const SPOTIFY_URL_REGEX = /https?:\/\/open\.spotify\.com\/[^\s]+/i;

function parseSpotifyInput(input) {
  if (!input) return null;
  const text = String(input);
  const uriMatch = text.match(SPOTIFY_URI_REGEX);
  if (uriMatch) {
    return { type: uriMatch[1].toLowerCase(), id: uriMatch[2] };
  }

  const urlMatch = text.match(SPOTIFY_URL_REGEX);
  if (!urlMatch) return null;

  try {
    const url = new URL(urlMatch[0]);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0]?.startsWith("intl-")) {
      parts.shift();
    }
    const type = parts[0];
    const id = parts[1];
    if (!type || !id) return null;
    if (!["track", "playlist", "album"].includes(type)) return null;
    return { type, id };
  } catch (error) {
    return null;
  }
}

function buildSpotifyUrl(ref) {
  if (!ref?.type || !ref?.id) return null;
  const type = String(ref.type).toLowerCase();
  const id = String(ref.id);
  if (!["track", "playlist", "album"].includes(type)) return null;
  if (!/^[a-zA-Z0-9]+$/.test(id)) return null;
  return `https://open.spotify.com/${type}/${id}`;
}

async function fetchSpotifyOEmbedTitle(refOrUrl) {
  const spotifyUrl = typeof refOrUrl === "string"
    ? buildSpotifyUrl(parseSpotifyInput(refOrUrl))
    : buildSpotifyUrl(refOrUrl);
  if (!spotifyUrl) return null;

  const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`;

  try {
    const response = await fetch(endpoint, {
      headers: {
        "user-agent": "yova-discord-bot-v1",
      },
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    const title = typeof data?.title === "string" ? data.title.trim() : "";
    return title ? title : null;
  } catch (error) {
    return null;
  }
}

function mapSpotifyPlaylistItemToEntry(item) {
  const track = item?.track || item?.data || item;
  if (!track) return null;
  if (track.is_local) return null;
  if (track.is_playable === false) return null;
  if (track.playability?.playable === false) return null;

  const title = String(track.name || "").trim();

  const artists = Array.isArray(track.artists)
    ? track.artists.map((a) => a?.name).filter(Boolean)
    : Array.isArray(track.artists?.items)
      ? track.artists.items
        .map((a) => a?.profile?.name || a?.name)
        .filter(Boolean)
      : [];
  const artist = artists.join(", ");
  if (!title) return null;

  const durationMs =
    Number(track.duration_ms) ||
    Number(track.duration?.totalMilliseconds) ||
    0;

  const spotifyUrl =
    track.external_urls?.spotify ||
    (typeof track.uri === "string" ? buildSpotifyUrl(parseSpotifyInput(track.uri)) : null) ||
    null;

  return {
    title,
    artist: artist || null,
    durationMs,
    spotifyUrl,
  };
}

async function fetchSpotifyPlaylistTrackEntries(playlistId, offset = 0, limit = 50) {
  const id = String(playlistId || "").trim();
  if (!id) return [];
  const safeLimit = Math.max(1, Math.min(Math.trunc(Number(limit) || 50), 50));
  const safeOffset = Math.max(0, Math.trunc(Number(offset) || 0));
  const preview =
    (await fetchSpotifyPlaylistPreviewFromEmbed(id)) ||
    (await fetchSpotifyPlaylistPreviewFromPage(id));
  if (!preview) return [];

  if (safeOffset >= preview.entries.length) {
    const pagingError = new Error("SPOTIFY_PLAYLIST_PAGING_UNAVAILABLE");
    pagingError.code = "SPOTIFY_PLAYLIST_PAGING_UNAVAILABLE";
    pagingError.details = {
      available: preview.entries.length,
      totalTracks: preview.meta.totalTracks,
    };
    throw pagingError;
  }

  return preview.entries.slice(safeOffset, safeOffset + safeLimit);
}

function extractInitialStateFromPlaylistHtml(html) {
  const match = String(html || "").match(
    /<script id="initialState" type="text\/plain">([^<]+)<\/script>/
  );
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch (error) {
    return null;
  }
}

function extractPlaylistPreviewFromInitialState(initialState, playlistId) {
  const id = String(playlistId || "").trim();
  if (!initialState || !id) return null;

  const key = `spotify:playlist:${id}`;
  const playlist = initialState?.entities?.items?.[key];
  const title = playlist?.name || playlist?.data?.name || null;
  const content = playlist?.content || null;
  const totalTracks = Number(content?.totalCount) || 0;
  const items = Array.isArray(content?.items) ? content.items : [];

  const entries = items
    .map((wrapper) => wrapper?.itemV2?.data || wrapper?.itemV2 || wrapper?.track || wrapper)
    .map(mapSpotifyPlaylistItemToEntry)
    .filter(Boolean);

  return {
    meta: { id, name: title, totalTracks },
    entries,
    nextOffset: Number(content?.pagingInfo?.nextOffset) || null,
  };
}

function extractNextDataFromEmbedHtml(html) {
  const match = String(html || "").match(
    /<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    return null;
  }
}

function extractPlaylistPreviewFromNextData(nextData, playlistId) {
  const id = String(playlistId || "").trim();
  if (!nextData || !id) return null;

  const entity = nextData?.props?.pageProps?.state?.data?.entity;
  const trackList = Array.isArray(entity?.trackList) ? entity.trackList : [];
  if (!trackList.length) return null;

  const entries = trackList
    .filter((t) => t?.entityType === "track")
    .map((t) => ({
      title: String(t?.title || "").trim(),
      artist: t?.subtitle ? String(t.subtitle).trim() : null,
      durationMs: Number(t?.duration) || 0,
      spotifyUrl:
        typeof t?.uri === "string" ? buildSpotifyUrl(parseSpotifyInput(t.uri)) : null,
    }))
    .filter((e) => e.title);

  const title = entity?.title ? String(entity.title).trim() : null;

  return {
    meta: { id, name: title || null, totalTracks: entries.length },
    entries,
    nextOffset: null,
  };
}

async function fetchSpotifyPlaylistPreviewFromEmbed(playlistId) {
  const id = String(playlistId || "").trim();
  if (!id) return null;
  const url = `https://open.spotify.com/embed/playlist/${id}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const html = await response.text().catch(() => "");
  const nextData = extractNextDataFromEmbedHtml(html);
  return extractPlaylistPreviewFromNextData(nextData, id);
}

async function fetchSpotifyPlaylistPreviewFromPage(playlistId) {
  const id = String(playlistId || "").trim();
  if (!id) return null;
  const url = `https://open.spotify.com/playlist/${id}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const html = await response.text().catch(() => "");
  const initialState = extractInitialStateFromPlaylistHtml(html);
  return extractPlaylistPreviewFromInitialState(initialState, id);
}

async function fetchSpotifyPlaylistMeta(playlistId) {
  const id = String(playlistId || "").trim();
  if (!id) return null;
  const preview =
    (await fetchSpotifyPlaylistPreviewFromEmbed(id)) ||
    (await fetchSpotifyPlaylistPreviewFromPage(id));
  return preview?.meta || null;
}

module.exports = {
  parseSpotifyInput,
  buildSpotifyUrl,
  fetchSpotifyOEmbedTitle,
  fetchSpotifyPlaylistMeta,
  fetchSpotifyPlaylistTrackEntries,
};
