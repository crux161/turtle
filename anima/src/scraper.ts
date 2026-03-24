import { load, type CheerioAPI } from "cheerio";

export interface SearchResult {
  id: string;
  title: string;
  img: string;
}

export interface Episode {
  epNum: number;
  link: string;
}

export interface AutocompleteSuggestion {
  id: number;
  romaji: string;
  english: string | null;
  searchTitle: string;
}

export interface StreamSource {
  url: string;
  referer: string;
}

type ServerKind = "SUB" | "HSUB" | "DUB" | "UNKNOWN";

interface ServerCandidate {
  url: string;
  kind: ServerKind;
  priority: number;
}

interface AniListMedia {
  id: number;
  title?: {
    romaji?: string | null;
    english?: string | null;
  };
}

interface AniListSuggestionsResponse {
  data?: {
    Page?: {
      media?: AniListMedia[];
    };
  };
}

const DEFAULT_BASE_URL = "https://anitaku.to";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const DIRECT_STREAM_RE =
  /(?:https?:)?\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;
const PACKED_EVAL_RE =
  /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\(\s*(['"])((?:\\.|(?!\1)[\s\S])*)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])((?:\\.|(?!\5)[\s\S])*)\5\.split\((['"])\|\7\)\s*\)\)/g;
const SERVER_KIND_PRIORITY: Record<ServerKind, number> = {
  SUB: 0,
  HSUB: 1,
  DUB: 2,
  UNKNOWN: 3,
};
const PROVIDER_HOST_PRIORITY = ["otakuhg.site", "otakuvid.online"];

export async function getSuggestions(query: string): Promise<AutocompleteSuggestion[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) {
    return [];
  }

  const graphqlQuery = `
    query ($search: String) {
      Page(page: 1, perPage: 6) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          id
          title {
            romaji
            english
          }
        }
      }
    }
  `;

  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: graphqlQuery,
        variables: { search: trimmedQuery },
      }),
    });

    if (!response.ok) {
      throw new Error(`AniList autocomplete request failed with status ${response.status}`);
    }

    const json = (await response.json()) as AniListSuggestionsResponse;
    const media = json.data?.Page?.media ?? [];

    return media.flatMap((item) => {
      const romaji = item.title?.romaji?.trim() ?? "";
      const english = item.title?.english?.trim() || null;
      const searchTitle = english || romaji;

      if (!item.id || !romaji || !searchTitle) {
        return [];
      }

      return [
        {
          id: item.id,
          romaji,
          english,
          searchTitle,
        },
      ];
    });
  } catch (caughtError) {
    console.error("AniList autocomplete error:", caughtError);
    return [];
  }
}

export async function search(query: string): Promise<SearchResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const searchUrl = new URL("/search.html", getBaseUrl());
  searchUrl.searchParams.set("keyword", trimmedQuery);

  const { body, finalUrl } = await fetchText(searchUrl.toString());
  const $ = load(body);
  const results = new Map<string, SearchResult>();

  $("section.content_left .last_episodes ul.items > li").each((_, item) => {
    const anchor = $(item).find("p.name a[href*=\"/category/\"]").first();
    const href = anchor.attr("href");
    const id = extractShowId(href);

    if (!id) {
      return;
    }

    const title = cleanText(anchor.attr("title") ?? anchor.text());
    const imgSrc =
      $(item).find(".img img").attr("src") ??
      $(item).find(".img img").attr("data-src") ??
      "";

    if (!title) {
      return;
    }

    results.set(id, {
      id,
      title,
      img: resolveUrl(imgSrc, finalUrl),
    });
  });

  return [...results.values()];
}

export async function getEpisodes(showId: string): Promise<Episode[]> {
  const normalizedShowId = normalizeShowId(showId);
  if (!normalizedShowId) {
    return [];
  }

  const categoryUrl = new URL(`/category/${normalizedShowId}`, getBaseUrl()).toString();
  const { body, finalUrl } = await fetchText(categoryUrl);
  const $ = load(body);
  const episodes = new Map<number, Episode>();

  collectEpisodes($, finalUrl, episodes);

  return [...episodes.values()].sort((left, right) => left.epNum - right.epNum);
}

export interface ProviderOption {
  kind: ServerKind;
  label: string;
}

export async function listProviders(episodeLink: string): Promise<ProviderOption[]> {
  const episodeUrl = resolveUrl(episodeLink, getBaseUrl());
  const { body, finalUrl } = await fetchText(episodeUrl);
  const $ = load(body);
  const servers = collectServerCandidates($, finalUrl);

  const seen = new Set<ServerKind>();
  const providers: ProviderOption[] = [];

  for (const server of servers) {
    if (!seen.has(server.kind)) {
      seen.add(server.kind);
      providers.push({ kind: server.kind, label: formatServerKindLabel(server.kind) });
    }
  }

  return providers;
}

function formatServerKindLabel(kind: ServerKind): string {
  switch (kind) {
    case "SUB": return "Sub";
    case "HSUB": return "Hard Sub";
    case "DUB": return "Dub";
    default: return "Default";
  }
}

export async function extractStreamUrl(episodeLink: string): Promise<string> {
  return (await extractStreamSource(episodeLink)).url;
}

export async function extractStreamSource(
  episodeLink: string,
  preferredKind?: string,
): Promise<StreamSource> {
  const episodeUrl = resolveUrl(episodeLink, getBaseUrl());
  const { body, finalUrl } = await fetchText(episodeUrl);
  const $ = load(body);
  let servers = collectServerCandidates($, finalUrl);

  if (preferredKind) {
    const normalizedPref = preferredKind.toUpperCase();
    const preferred = servers.filter((s) => s.kind === normalizedPref);
    if (preferred.length > 0) {
      servers = preferred;
    }
  }

  let lastError: unknown;

  for (const server of servers) {
    try {
      return await resolveStreamSource(server.url, finalUrl);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    lastError instanceof Error
      ? `Unable to extract a playable stream from ${episodeUrl}: ${lastError.message}`
      : `Unable to extract a playable stream from ${episodeUrl}`,
  );
}

function collectEpisodes(
  $: CheerioAPI,
  pageUrl: string,
  episodes: Map<number, Episode>,
): void {
  $("#load_ep a[data-num][href], #episode_related a[data-num][href], .ep-range a[data-num][href]").each(
    (_, item) => {
      const href = $(item).attr("href");
      const rawEpisodeNumber = $(item).attr("data-num") ?? $(item).find(".name").text();
      const epNum = parseEpisodeNumber(rawEpisodeNumber);

      if (!href || epNum === null || Number.isNaN(epNum)) {
        return;
      }

      episodes.set(epNum, {
        epNum,
        link: resolveUrl(href, pageUrl),
      });
    },
  );
}

function collectServerCandidates($: CheerioAPI, pageUrl: string): ServerCandidate[] {
  const candidates: ServerCandidate[] = [];
  const seen = new Set<string>();

  const sections = $(".anime_muti_link .server-items[data-type]");
  if (sections.length > 0) {
    sections.each((_, section) => {
      const kind = normalizeServerKind($(section).attr("data-type"));
      $(section)
        .find("a[data-video]")
        .each((index, link) => {
          const url = resolveUrl($(link).attr("data-video") ?? "", pageUrl);
          if (!url || seen.has(url)) {
            return;
          }

          seen.add(url);
          candidates.push({
            url,
            kind,
            priority: index,
          });
        });
    });
  }

  if (candidates.length === 0) {
    $("[data-video]").each((index, link) => {
      const url = resolveUrl($(link).attr("data-video") ?? "", pageUrl);
      if (!url || seen.has(url)) {
        return;
      }

      seen.add(url);
      candidates.push({
        url,
        kind: "UNKNOWN",
        priority: index,
      });
    });
  }

  return candidates.sort((left, right) => compareServerCandidates(left, right));
}

async function resolveStreamSource(url: string, referer: string, depth = 0): Promise<StreamSource> {
  if (depth > 4) {
    throw new Error(`Exceeded iframe/provider resolution depth for ${url}`);
  }

  if (looksLikeDirectStream(url)) {
    return {
      referer,
      url,
    };
  }

  const { body, response, finalUrl } = await fetchText(url, {
    headers: {
      Referer: referer,
    },
  });

  if (looksLikeDirectStream(finalUrl) || isDirectMediaResponse(response)) {
    return {
      referer: url,
      url: finalUrl,
    };
  }

  const directUrls = collectDirectStreamUrls(body, finalUrl);
  if (directUrls.length > 0) {
    return {
      referer: finalUrl,
      url: pickPreferredStream(directUrls),
    };
  }

  const unpackedScripts = unpackPackedScripts(body);
  for (const script of unpackedScripts) {
    const unpackedDirectUrls = collectDirectStreamUrls(script, finalUrl);
    if (unpackedDirectUrls.length > 0) {
      return {
        referer: finalUrl,
        url: pickPreferredStream(unpackedDirectUrls),
      };
    }
  }

  const $ = load(body);
  const iframeSources = $("iframe[src]")
    .map((_, iframe) => resolveUrl($(iframe).attr("src") ?? "", finalUrl))
    .get()
    .filter(Boolean);

  for (const iframeSource of iframeSources) {
    try {
      return await resolveStreamSource(iframeSource, finalUrl, depth + 1);
    } catch {
      // Try the next iframe/provider candidate.
    }
  }

  throw new Error(`No .m3u8 or .mp4 stream URL found in provider page ${finalUrl}`);
}

function unpackPackedScripts(html: string): string[] {
  const scripts: string[] = [];

  for (const match of html.matchAll(PACKED_EVAL_RE)) {
    const payload = decodeStringLiteral(`${match[1]}${match[2]}${match[1]}`);
    const radix = Number.parseInt(match[3], 10);
    const count = Number.parseInt(match[4], 10);
    const symtab = decodeStringLiteral(`${match[5]}${match[6]}${match[5]}`).split("|");

    if (!Number.isFinite(radix) || !Number.isFinite(count) || symtab.length === 0) {
      continue;
    }

    scripts.push(unpackDeanEdwards(payload, radix, count, symtab));
  }

  return scripts;
}

function unpackDeanEdwards(
  payload: string,
  radix: number,
  count: number,
  symtab: string[],
): string {
  if (radix < 2 || symtab.length === 0) {
    return payload;
  }

  const lookup = (word: string): string => {
    const index = unbase(word, radix);

    if (!Number.isInteger(index) || index < 0 || index >= count || index >= symtab.length) {
      return word;
    }

    return symtab[index] || word;
  };

  return payload.replace(/\b\w+\b/g, lookup);
}

function decodeStringLiteral(expression: string): string {
  const trimmed = expression.trim();
  const quote = trimmed[0];

  if (!quote || quote !== trimmed[trimmed.length - 1] || !"'\"`".includes(quote)) {
    return trimmed;
  }

  let result = "";

  for (let index = 1; index < trimmed.length - 1; index += 1) {
    const char = trimmed[index];

    if (char !== "\\") {
      result += char;
      continue;
    }

    index += 1;
    const escaped = trimmed[index];

    switch (escaped) {
      case "n":
        result += "\n";
        break;
      case "r":
        result += "\r";
        break;
      case "t":
        result += "\t";
        break;
      case "b":
        result += "\b";
        break;
      case "f":
        result += "\f";
        break;
      case "v":
        result += "\v";
        break;
      case "0":
        result += "\0";
        break;
      case "x": {
        const hex = trimmed.slice(index + 1, index + 3);
        if (/^[\da-fA-F]{2}$/.test(hex)) {
          result += String.fromCharCode(Number.parseInt(hex, 16));
          index += 2;
          break;
        }
        result += escaped;
        break;
      }
      case "u": {
        const hex = trimmed.slice(index + 1, index + 5);
        if (/^[\da-fA-F]{4}$/.test(hex)) {
          result += String.fromCharCode(Number.parseInt(hex, 16));
          index += 4;
          break;
        }
        result += escaped;
        break;
      }
      default:
        result += escaped;
        break;
    }
  }

  return result;
}

function unbase(value: string, radix: number): number {
  if (radix <= 36) {
    return Number.parseInt(value, radix);
  }

  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const dictionary = alphabet.slice(0, radix);
  let result = 0;

  for (const char of value) {
    const digit = dictionary.indexOf(char);
    if (digit === -1) {
      return Number.NaN;
    }
    result = result * radix + digit;
  }

  return result;
}

function collectDirectStreamUrls(input: string, baseUrl: string): string[] {
  const urls = new Set<string>();

  for (const match of input.matchAll(DIRECT_STREAM_RE)) {
    const candidate = resolveUrl(match[0].replaceAll("&amp;", "&"), baseUrl);
    if (looksLikeDirectStream(candidate)) {
      urls.add(candidate);
    }
  }

  return [...urls];
}

function pickPreferredStream(urls: string[]): string {
  return [...new Set(urls)].sort((left, right) => scoreStreamUrl(left) - scoreStreamUrl(right))[0];
}

function scoreStreamUrl(url: string): number {
  let score = 0;

  if (/master\.m3u8/i.test(url)) {
    score -= 50;
  }

  if (/\.m3u8(?:\?|$)/i.test(url)) {
    score -= 30;
  }

  if (/\.mp4(?:\?|$)/i.test(url)) {
    score -= 10;
  }

  if (/1080|720|hls4/i.test(url)) {
    score -= 5;
  }

  return score;
}

function compareServerCandidates(left: ServerCandidate, right: ServerCandidate): number {
  const kindDelta = SERVER_KIND_PRIORITY[left.kind] - SERVER_KIND_PRIORITY[right.kind];
  if (kindDelta !== 0) {
    return kindDelta;
  }

  const hostDelta = hostPriority(left.url) - hostPriority(right.url);
  if (hostDelta !== 0) {
    return hostDelta;
  }

  return left.priority - right.priority;
}

function hostPriority(url: string): number {
  const hostname = getHostname(url);
  const index = PROVIDER_HOST_PRIORITY.findIndex((host) => host === hostname);
  return index === -1 ? PROVIDER_HOST_PRIORITY.length : index;
}

function normalizeServerKind(kind: string | undefined): ServerKind {
  const normalizedKind = cleanText(kind ?? "").toUpperCase();
  if (normalizedKind === "SUB" || normalizedKind === "HSUB" || normalizedKind === "DUB") {
    return normalizedKind;
  }
  return "UNKNOWN";
}

function normalizeShowId(showId: string): string {
  let normalized = showId.trim();
  if (!normalized) {
    return "";
  }

  normalized = normalized.replace(/^https?:\/\/[^/]+/i, "");
  normalized = normalized.replace(/^\/+/, "");
  normalized = normalized.replace(/^category\//, "");
  normalized = normalized.split(/[?#]/, 1)[0] ?? normalized;

  return normalized.replace(/\/+$/, "");
}

function extractShowId(href: string | undefined): string {
  if (!href) {
    return "";
  }

  const path = href.replace(/^https?:\/\/[^/]+/i, "");
  const match = path.match(/\/category\/([^/?#]+)/i);
  return match?.[1] ?? "";
}

function parseEpisodeNumber(rawValue: string): number | null {
  const match = cleanText(rawValue).match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeDirectStream(url: string): boolean {
  return /\.(?:m3u8|mp4)(?:\?|$)/i.test(url);
}

function isDirectMediaResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return (
    contentType.includes("application/vnd.apple.mpegurl") ||
    contentType.includes("application/x-mpegurl") ||
    contentType.includes("audio/mpegurl") ||
    contentType.startsWith("video/")
  );
}

function resolveUrl(input: string, baseUrl: string): string {
  if (!input) {
    return "";
  }

  try {
    return new URL(input, baseUrl).toString();
  } catch {
    return input;
  }
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function fetchText(
  url: string,
  init: RequestInit = {},
): Promise<{ body: string; response: Response; finalUrl: string }> {
  const response = await fetch(url, {
    redirect: "follow",
    ...init,
    headers: mergeHeaders(init.headers),
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status} ${response.statusText} for ${url}`);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const body = contentType.startsWith("video/") ? "" : await response.text();

  return {
    body,
    response,
    finalUrl: response.url || url,
  };
}

function mergeHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers({
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "User-Agent": DEFAULT_USER_AGENT,
  });

  if (headers) {
    new Headers(headers).forEach((value, key) => {
      merged.set(key, value);
    });
  }

  return merged;
}

function getBaseUrl(): string {
  const processLike = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };

  return normalizeBaseUrl(processLike.process?.env?.ANI_SCRAPER_BASE_URL ?? DEFAULT_BASE_URL);
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}
