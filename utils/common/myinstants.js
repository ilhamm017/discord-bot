"use strict";

const path = require("path");
const {
  getCachedTrackUrl,
  getMyInstantsCacheKey,
} = require("./media_cache");

const MYINSTANTS_BASE_URL = "https://www.myinstants.com";
const MYINSTANTS_DEFAULT_SEARCH_LIMIT = 5;
const MYINSTANTS_PREPLAY_DELAY_MS = 3000;
const MYINSTANTS_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const MYINSTANTS_KEYWORD_REGEX = /\bmyinstants?\b/i;
const MYINSTANTS_SOUND_EFFECT_REGEX =
  /\b(sound\s*effects?|soundboard|sfx|efek\s+suara)\b/i;
const MYINSTANTS_AUDIO_PATH_REGEX = /\/media\/sounds\/[^"'?#<>\s]+\.(?:mp3|wav|ogg)/i;
const MYINSTANTS_PAGE_PATH_REGEX = /\/(?:[a-z]{2}\/)?instant[s]?\/[^"'?#<>\s]+\/?/i;
const MYINSTANTS_PAGE_LINK_REGEX =
  /<a\b[^>]*href="([^"]*\/(?:[a-z]{2}\/)?instant[s]?\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/&#(\d+);/g, (_, codePoint) => {
      const valueNum = Number(codePoint);
      return Number.isFinite(valueNum) ? String.fromCodePoint(valueNum) : _;
    });
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function safeUrl(input, baseUrl = MYINSTANTS_BASE_URL) {
  try {
    return new URL(String(input || ""), baseUrl).toString();
  } catch (error) {
    return null;
  }
}

function isMyInstantsUrl(input) {
  try {
    const url = new URL(String(input || ""));
    return /(^|\.)myinstants\.com$/i.test(url.hostname);
  } catch (error) {
    return false;
  }
}

function isMyInstantsAudioUrl(input) {
  return isMyInstantsUrl(input) && MYINSTANTS_AUDIO_PATH_REGEX.test(String(input || ""));
}

function isMyInstantsPageUrl(input) {
  return isMyInstantsUrl(input) && MYINSTANTS_PAGE_PATH_REGEX.test(String(input || ""));
}

function detectMyInstantsRequest(query, options = {}) {
  const rawQuery = String(query || "").trim();
  const explicitSource = String(options.source || "auto").toLowerCase();

  if (!rawQuery) {
    return {
      shouldUseMyInstants: explicitSource === "myinstants",
      kind: "search",
      rawQuery,
      cleanedQuery: "",
    };
  }

  if (explicitSource === "youtube") {
    return {
      shouldUseMyInstants: false,
      kind: null,
      rawQuery,
      cleanedQuery: rawQuery,
    };
  }

  if (isMyInstantsAudioUrl(rawQuery)) {
    return {
      shouldUseMyInstants: true,
      kind: "audio",
      rawQuery,
      cleanedQuery: rawQuery,
      audioUrl: rawQuery,
    };
  }

  if (isMyInstantsPageUrl(rawQuery)) {
    return {
      shouldUseMyInstants: true,
      kind: "page",
      rawQuery,
      cleanedQuery: rawQuery,
      pageUrl: rawQuery,
    };
  }

  const hasKeyword = MYINSTANTS_KEYWORD_REGEX.test(rawQuery);
  const hasSoundEffectHint = MYINSTANTS_SOUND_EFFECT_REGEX.test(rawQuery);
  const shouldUseMyInstants =
    explicitSource === "myinstants" || hasKeyword || hasSoundEffectHint;

  if (!shouldUseMyInstants) {
    return {
      shouldUseMyInstants: false,
      kind: null,
      rawQuery,
      cleanedQuery: rawQuery,
    };
  }

  const cleanedQuery = rawQuery
    .replace(/\bfrom\b/gi, " ")
    .replace(/\bdari\b/gi, " ")
    .replace(/\b(play|putar|putarkan|puter|putarin|setel|mainkan)\b/gi, " ")
    .replace(/\bmyinstants?\b/gi, " ")
    .replace(/\bsound\s*effects?\b/gi, " ")
    .replace(/\bsoundboard\b/gi, " ")
    .replace(/\bsfx\b/gi, " ")
    .replace(/\befek\s+suara\b/gi, " ")
    .replace(/\bsuara\b/gi, " ")
    .replace(/\beffect\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    shouldUseMyInstants: true,
    kind: "search",
    rawQuery,
    cleanedQuery,
  };
}

async function fetchHtml(url, options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch API tidak tersedia untuk resolver MyInstants.");
  }

  const response = await fetchImpl(url, {
    headers: {
      "user-agent": MYINSTANTS_USER_AGENT,
      "accept-language": "en-US,en;q=0.9,id;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`MyInstants request gagal (${response.status})`);
  }

  return response.text();
}

function parseMyInstantsSearchResults(html, options = {}) {
  const limit = Number.isInteger(options.limit)
    ? options.limit
    : MYINSTANTS_DEFAULT_SEARCH_LIMIT;
  const seen = new Set();
  const results = [];
  let match;

  while ((match = MYINSTANTS_PAGE_LINK_REGEX.exec(String(html || ""))) !== null) {
    const pageUrl = safeUrl(match[1], options.baseUrl || MYINSTANTS_BASE_URL);
    if (!pageUrl || seen.has(pageUrl)) continue;

    const title = stripHtml(match[2]);
    if (!title) continue;

    seen.add(pageUrl);
    results.push({
      source: "myinstants",
      title,
      url: pageUrl,
      audioUrl: null,
    });

    if (results.length >= limit) break;
  }

  return results;
}

function parseMyInstantsPage(html, options = {}) {
  const text = String(html || "");
  const pageUrl = safeUrl(options.pageUrl || MYINSTANTS_BASE_URL, MYINSTANTS_BASE_URL);
  const audioPathMatch = text.match(MYINSTANTS_AUDIO_PATH_REGEX);
  const titleMatch =
    text.match(/<meta\b[^>]*property="og:title"[^>]*content="([^"]+)"/i) ||
    text.match(/<title>([\s\S]*?)<\/title>/i);

  const title = stripHtml(titleMatch ? titleMatch[1] : options.fallbackTitle || "");
  const audioUrl = audioPathMatch ? safeUrl(audioPathMatch[0], MYINSTANTS_BASE_URL) : null;

  return {
    source: "myinstants",
    title: title || options.fallbackTitle || pageUrl || "MyInstants",
    url: pageUrl,
    pageUrl,
    audioUrl,
  };
}

async function searchMyInstants(query, limit = MYINSTANTS_DEFAULT_SEARCH_LIMIT, options = {}) {
  const cleanedQuery = String(query || "").trim();
  if (!cleanedQuery) return [];

  const searchUrl = safeUrl(
    `/en/search/?name=${encodeURIComponent(cleanedQuery)}`,
    MYINSTANTS_BASE_URL
  );
  const html = await fetchHtml(searchUrl, options);
  return parseMyInstantsSearchResults(html, {
    baseUrl: MYINSTANTS_BASE_URL,
    limit,
  });
}

async function resolveMyInstantsResult(result, options = {}) {
  if (!result) return null;

  if (result.audioUrl && isMyInstantsAudioUrl(result.audioUrl)) {
    return {
      source: "myinstants",
      title: result.title || path.basename(result.audioUrl),
      url: result.url || result.pageUrl || result.audioUrl,
      pageUrl: result.pageUrl || result.url || null,
      audioUrl: result.audioUrl,
    };
  }

  const pageUrl = result.pageUrl || result.url;
  if (!pageUrl) return null;

  const html = await fetchHtml(pageUrl, options);
  const resolved = parseMyInstantsPage(html, {
    pageUrl,
    fallbackTitle: result.title || null,
  });

  if (!resolved.audioUrl) {
    throw new Error("Link audio MyInstants tidak ditemukan di halaman tersebut.");
  }

  return resolved;
}

async function resolveMyInstantsTrack(query, options = {}) {
  const intent = detectMyInstantsRequest(query, options);
  if (!intent.shouldUseMyInstants) return null;

  if (intent.kind === "audio") {
    return {
      source: "myinstants",
      title: path.basename(intent.audioUrl),
      url: intent.audioUrl,
      pageUrl: null,
      audioUrl: intent.audioUrl,
    };
  }

  if (intent.kind === "page") {
    return resolveMyInstantsResult(
      {
        source: "myinstants",
        title: null,
        url: intent.pageUrl,
        pageUrl: intent.pageUrl,
        audioUrl: null,
      },
      options
    );
  }

  const results = await searchMyInstants(
    intent.cleanedQuery,
    options.limit || MYINSTANTS_DEFAULT_SEARCH_LIMIT,
    options
  );
  if (!results.length) return null;

  return resolveMyInstantsResult(results[0], options);
}

function buildMyInstantsTrack(result, options = {}) {
  if (!result?.audioUrl) {
    throw new Error("Track MyInstants membutuhkan audioUrl.");
  }

  const title = result.title || result.pageUrl || result.audioUrl || "MyInstants";
  const thumbnails = result.thumbnail ? [{ url: result.thumbnail }] : [];
  const cacheKey = getMyInstantsCacheKey(result.audioUrl);
  const cachedUrl = cacheKey ? getCachedTrackUrl(cacheKey) : null;

  const track = {
    source: "myinstants",
    url: result.audioUrl,
    originalUrl: result.audioUrl,
    sourcePageUrl: result.pageUrl || result.url || null,
    cacheKey,
    prePlayDelayMs: MYINSTANTS_PREPLAY_DELAY_MS,
    title,
    requestedBy: options.requestedBy || null,
    requestedById: options.requestedById || null,
    requestedByTag: options.requestedByTag || options.requestedBy || null,
    info: {
      video_details: {
        title,
        durationInSec: 0,
        thumbnails,
      },
    },
  };

  if (cachedUrl) {
    track.cachedUrl = cachedUrl;
  }

  return track;
}

module.exports = {
  MYINSTANTS_BASE_URL,
  MYINSTANTS_DEFAULT_SEARCH_LIMIT,
  MYINSTANTS_PREPLAY_DELAY_MS,
  buildMyInstantsTrack,
  detectMyInstantsRequest,
  isMyInstantsAudioUrl,
  isMyInstantsPageUrl,
  isMyInstantsUrl,
  parseMyInstantsPage,
  parseMyInstantsSearchResults,
  resolveMyInstantsResult,
  resolveMyInstantsTrack,
  searchMyInstants,
};
