const play = require("play-dl");
const logger = require("./logger");
const { getSpotifyCache, saveSpotifyCache } = require("../storage/db");

let config = {};
try {
  config = require("../config.json");
} catch (error) {
  config = {};
}

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_URI_REGEX = /spotify:(track|playlist|album):([a-zA-Z0-9]+)/i;
const SPOTIFY_URL_REGEX = /https?:\/\/open\.spotify\.com\/[^\s]+/i;

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function getSpotifyConfig() {
  const clientId =
    config.spotify_client_id ||
    config.spotifyClientId ||
    process.env.SPOTIFY_CLIENT_ID;
  const clientSecret =
    config.spotify_client_secret ||
    config.spotifyClientSecret ||
    process.env.SPOTIFY_CLIENT_SECRET;
  return { clientId, clientSecret };
}

function isSpotifyConfigured() {
  const { clientId, clientSecret } = getSpotifyConfig();
  return Boolean(clientId && clientSecret);
}

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

async function getSpotifyToken() {
  const { clientId, clientSecret } = getSpotifyConfig();
  if (!clientId || !clientSecret) {
    throw new Error("SPOTIFY_CONFIG_MISSING");
  }

  const now = Date.now();
  if (cachedToken && cachedTokenExpiresAt - now > 30_000) {
    return cachedToken;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );
  const body = new URLSearchParams({ grant_type: "client_credentials" });

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error_description || data?.error || "SPOTIFY_AUTH_FAILED";
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  cachedToken = data.access_token;
  cachedTokenExpiresAt = now + Number(data.expires_in || 0) * 1000;
  return cachedToken;
}

async function spotifyRequest(url) {
  const token = await getSpotifyToken();
  const target = url.startsWith("http") ? url : `${SPOTIFY_API_BASE}${url}`;

  const response = await fetch(target, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    cachedToken = null;
    cachedTokenExpiresAt = 0;
    const retryToken = await getSpotifyToken();
    const retryResponse = await fetch(target, {
      headers: { Authorization: `Bearer ${retryToken}` },
    });
    if (!retryResponse.ok) {
      const data = await retryResponse.json().catch(() => ({}));
      const error = new Error(data?.error?.message || "SPOTIFY_REQUEST_FAILED");
      error.status = retryResponse.status;
      throw error;
    }
    return retryResponse.json();
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data?.error?.message || "SPOTIFY_REQUEST_FAILED");
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function mapSpotifyTrack(track) {
  if (!track || !track.id) return null;
  if (track.is_local) return null;
  const artists = Array.isArray(track.artists)
    ? track.artists.map((artist) => artist.name).filter(Boolean)
    : [];
  return {
    id: track.id,
    name: track.name || track.title || "",
    artists,
    durationMs: Number(track.duration_ms) || 0,
    isPlayable: track.is_playable !== false,
  };
}

async function fetchAllPaging(paging) {
  if (!paging) return [];
  const items = [];
  let current = paging;
  while (current) {
    if (Array.isArray(current.items)) {
      items.push(...current.items);
    }
    if (current.next) {
      current = await spotifyRequest(current.next);
    } else {
      break;
    }
  }
  return items;
}

async function getSpotifyTrack(id) {
  const data = await spotifyRequest(`/tracks/${id}`);
  return mapSpotifyTrack(data);
}

async function getSpotifyPlaylist(id) {
  const data = await spotifyRequest(`/playlists/${id}`);
  const items = await fetchAllPaging(data.tracks);
  const tracks = items
    .map((item) => mapSpotifyTrack(item.track))
    .filter((track) => track && track.isPlayable !== false);
  return { name: data?.name || "Playlist Spotify", tracks };
}

async function getSpotifyAlbum(id) {
  const data = await spotifyRequest(`/albums/${id}`);
  const items = await fetchAllPaging(data.tracks);
  const tracks = items
    .map((item) => mapSpotifyTrack(item))
    .filter((track) => track && track.isPlayable !== false);
  return { name: data?.name || "Album Spotify", tracks };
}

function parseDurationToSeconds(raw) {
  if (!raw) return null;
  const parts = String(raw)
    .split(":")
    .map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return null;
  let seconds = 0;
  for (const part of parts) {
    seconds = seconds * 60 + part;
  }
  return seconds || null;
}

function getResultDurationSeconds(result) {
  if (!result) return null;
  if (Number.isFinite(result.durationInSec)) return result.durationInSec;
  if (Number.isFinite(result.durationInSeconds)) return result.durationInSeconds;
  if (Number.isFinite(result.duration)) return result.duration;
  if (typeof result.duration === "string") {
    return parseDurationToSeconds(result.duration);
  }
  if (typeof result.durationRaw === "string") {
    return parseDurationToSeconds(result.durationRaw);
  }
  return null;
}

function pickBestResult(results, durationMs) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const targetSeconds = durationMs ? Math.round(durationMs / 1000) : null;
  let fallback = null;
  let best = null;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const result of results) {
    if (!result?.url && !result?.id) continue;
    if (!fallback) fallback = result;
    if (!targetSeconds) continue;
    const seconds = getResultDurationSeconds(result);
    if (!seconds) continue;
    const diff = Math.abs(seconds - targetSeconds);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = result;
    }
  }

  return best || fallback;
}

async function resolveSpotifyTrackToYoutube(track) {
  if (!track?.id) return null;
  const cached = getSpotifyCache(track.id);
  if (cached?.youtubeUrl) {
    const title = cached.title || `${track.name} - ${track.artists.join(", ")}`;
    return {
      url: cached.youtubeUrl,
      title,
      spotify: track,
    };
  }

  const query = `${track.artists.join(" ")} - ${track.name}`.trim();
  if (!query) return null;

  let results;
  try {
    results = await play.search(query, { limit: 5 });
  } catch (error) {
    logger.warn("Spotify search on YouTube failed.", error);
    return null;
  }

  const best = pickBestResult(results, track.durationMs);
  if (!best) return null;

  const url =
    best.url ||
    (best.id ? `https://www.youtube.com/watch?v=${best.id}` : null);
  if (!url) return null;

  const title = `${track.name} - ${track.artists.join(", ")}`.trim();
  saveSpotifyCache({
    spotifyId: track.id,
    title,
    artists: track.artists.join(", "),
    durationMs: track.durationMs,
    youtubeUrl: url,
  });

  return { url, title, spotify: track };
}

async function resolveSpotifyTracks(tracks) {
  const resolved = [];
  const failed = [];
  const entries = Array.isArray(tracks) ? tracks : [];

  for (const track of entries) {
    try {
      const item = await resolveSpotifyTrackToYoutube(track);
      if (item) resolved.push(item);
      else failed.push(track);
    } catch (error) {
      logger.warn("Failed resolving Spotify track.", error);
      failed.push(track);
    }
  }

  return { resolved, failed };
}

async function fetchSpotifyCollection(ref) {
  if (!ref?.type || !ref?.id) {
    throw new Error("SPOTIFY_INVALID_REF");
  }

  if (ref.type === "track") {
    const track = await getSpotifyTrack(ref.id);
    return {
      type: "track",
      name: track?.name || "Spotify Track",
      tracks: track ? [track] : [],
    };
  }

  if (ref.type === "playlist") {
    const playlist = await getSpotifyPlaylist(ref.id);
    return { type: "playlist", name: playlist.name, tracks: playlist.tracks };
  }

  if (ref.type === "album") {
    const album = await getSpotifyAlbum(ref.id);
    return { type: "album", name: album.name, tracks: album.tracks };
  }

  throw new Error("SPOTIFY_INVALID_REF");
}

module.exports = {
  parseSpotifyInput,
  isSpotifyConfigured,
  fetchSpotifyCollection,
  resolveSpotifyTracks,
};
