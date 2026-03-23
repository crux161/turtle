import {
  type CacheStats,
  type EpisodeEntry,
  type FeaturedPayload,
  type HistoryEntry,
  type SearchResult,
  type ShowSummary,
  type Suggestion,
  type TurtleBootstrap,
  type TurtleRuntimeAdapter,
  type TurtleSettings,
  type UpdateCheckResult,
} from "./types";

const LEGACY_ACTION_TO_RESULT_TYPE = {
  episodes: "TURTLE_RESULT_EPISODES",
  search: "TURTLE_RESULT_SEARCH",
  stream: "TURTLE_RESULT_STREAM",
} as const;

const DEFAULT_SETTINGS: TurtleSettings = {
  cacheLimitMb: 256,
  uiScale: 1,
  autoplayNext: true,
  reduceMotion: false,
  compactDensity: false,
  themeFile: "ProteusDefault.theme.css",
  themeMode: "dark",
  updateRepoUrl: null,
  lastUpdateCheckAt: null,
};

const GAMELETTE_STORAGE_KEYS = {
  favorites: "turtle:favorites",
  history: "turtle:history",
  settings: "turtle:settings",
};

const DIRECT_OPEN_MESSAGE = "Launch Turtle through the standalone server or Electron app so the local API can attach securely.";

function createEmptyCacheStats(limitMb = DEFAULT_SETTINGS.cacheLimitMb): CacheStats {
  return {
    entryCount: 0,
    totalBytes: 0,
    limitBytes: limitMb * 1024 * 1024,
    utilization: 0,
  };
}

function normalizeShowId(id: string): string {
  return id.toLowerCase().replace(/\s+/g, " ").trim();
}

function createShowFromSearch(result: SearchResult): ShowSummary {
  return {
    showId: `scraper:${result.id}`,
    title: result.title,
    imgUrl: result.img,
    searchTitle: result.title,
    sourceId: result.id,
  };
}

function sanitizeText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function currentSeason(): { season: "WINTER" | "SPRING" | "SUMMER" | "FALL"; seasonYear: number } {
  const now = new Date();
  const month = now.getUTCMonth();
  if (month <= 1 || month === 11) {
    return { season: "WINTER", seasonYear: month === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear() };
  }
  if (month <= 4) {
    return { season: "SPRING", seasonYear: now.getUTCFullYear() };
  }
  if (month <= 7) {
    return { season: "SUMMER", seasonYear: now.getUTCFullYear() };
  }
  return { season: "FALL", seasonYear: now.getUTCFullYear() };
}

async function fetchAniListSuggestions(query: string): Promise<Suggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `
        query ($search: String) {
          Page(page: 1, perPage: 6) {
            media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
              id
              title { romaji english }
            }
          }
        }
      `,
      variables: { search: trimmed },
    }),
  });

  if (!response.ok) {
    throw new Error(`AniList suggestions failed with status ${response.status}`);
  }

  const json = await response.json() as {
    data?: {
      Page?: {
        media?: Array<{
          id: number;
          title?: {
            romaji?: string | null;
            english?: string | null;
          };
        }>;
      };
    };
  };

  return (json.data?.Page?.media ?? []).flatMap((item) => {
    const romaji = item.title?.romaji?.trim() ?? "";
    const english = item.title?.english?.trim() || null;
    const searchTitle = english || romaji;
    if (!item.id || !romaji || !searchTitle) {
      return [];
    }
    return [{
      id: item.id,
      romaji,
      english,
      searchTitle,
    }];
  });
}

function mapAniListMediaToShow(
  item: {
    id: number;
    title?: { romaji?: string | null; english?: string | null };
    description?: string | null;
    bannerImage?: string | null;
    coverImage?: { large?: string | null; extraLarge?: string | null };
    format?: string | null;
    season?: string | null;
    seasonYear?: number | null;
  },
  badge: string,
): ShowSummary | null {
  const title = item.title?.english?.trim() || item.title?.romaji?.trim() || "";
  const searchTitle = item.title?.english?.trim() || item.title?.romaji?.trim() || "";
  const imgUrl = item.coverImage?.extraLarge || item.coverImage?.large || "";

  if (!item.id || !title || !imgUrl) {
    return null;
  }

  const subtitleParts = [item.format, item.season, item.seasonYear].filter(Boolean);

  return {
    showId: `anilist:${item.id}`,
    title,
    subtitle: subtitleParts.join(" • "),
    description: sanitizeText(item.description),
    imgUrl,
    anilistId: item.id,
    badge,
    bannerImage: item.bannerImage || null,
    searchTitle,
  };
}

async function fetchAniListFeatured(history: HistoryEntry[]): Promise<FeaturedPayload> {
  const { season, seasonYear } = currentSeason();

  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `
        query ($season: MediaSeason!, $seasonYear: Int!) {
          trending: Page(page: 1, perPage: 12) {
            media(type: ANIME, sort: TRENDING_DESC) {
              id
              title { romaji english }
              description(asHtml: false)
              bannerImage
              coverImage { large extraLarge }
              format
              season
              seasonYear
            }
          }
          seasonal: Page(page: 1, perPage: 12) {
            media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC) {
              id
              title { romaji english }
              description(asHtml: false)
              bannerImage
              coverImage { large extraLarge }
              format
              season
              seasonYear
            }
          }
        }
      `,
      variables: {
        season,
        seasonYear,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`AniList featured failed with status ${response.status}`);
  }

  const json = await response.json() as {
    data?: {
      trending?: { media?: Array<any> };
      seasonal?: { media?: Array<any> };
    };
  };

  const trending = (json.data?.trending?.media ?? [])
    .map((item) => mapAniListMediaToShow(item, "Trending"))
    .filter((item): item is ShowSummary => Boolean(item));
  const seasonal = (json.data?.seasonal?.media ?? [])
    .map((item) => mapAniListMediaToShow(item, "Seasonal"))
    .filter((item): item is ShowSummary => Boolean(item));

  return {
    hero: trending[0] ?? seasonal[0] ?? null,
    continueWatching: history
      .filter((entry) => entry.progressSeconds > 0)
      .sort((left, right) => right.watchedAt - left.watchedAt)
      .slice(0, 8),
    trending,
    seasonal,
    updatedAt: Date.now(),
  };
}

function normalizeStreamPayload(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }

  if (Array.isArray(payload)) {
    const first = payload.find((candidate) => candidate && typeof candidate === "object" && "url" in candidate) as
      | { url?: unknown }
      | undefined;
    if (typeof first?.url === "string") {
      return first.url;
    }
  }

  throw new Error("The stream bridge returned an unsupported payload.");
}

function readLocalStorageJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalStorageJson<T>(key: string, value: T): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

class GameletteFallbackStore {
  listFavorites(): ShowSummary[] {
    return readLocalStorageJson<ShowSummary[]>(GAMELETTE_STORAGE_KEYS.favorites, []);
  }

  setFavorites(favorites: ShowSummary[]): ShowSummary[] {
    writeLocalStorageJson(GAMELETTE_STORAGE_KEYS.favorites, favorites);
    return favorites;
  }

  listHistory(): HistoryEntry[] {
    return readLocalStorageJson<HistoryEntry[]>(GAMELETTE_STORAGE_KEYS.history, []);
  }

  setHistory(history: HistoryEntry[]): HistoryEntry[] {
    writeLocalStorageJson(GAMELETTE_STORAGE_KEYS.history, history);
    return history;
  }

  getSettings(): TurtleSettings {
    return {
      ...DEFAULT_SETTINGS,
      ...readLocalStorageJson<Partial<TurtleSettings>>(GAMELETTE_STORAGE_KEYS.settings, {}),
    };
  }

  setSettings(settings: TurtleSettings): TurtleSettings {
    writeLocalStorageJson(GAMELETTE_STORAGE_KEYS.settings, settings);
    return settings;
  }
}

class InvalidStandaloneAdapter implements TurtleRuntimeAdapter {
  async bootstrap(): Promise<TurtleBootstrap> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  async search(): Promise<ShowSummary[]> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  async suggest(): Promise<Suggestion[]> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  async getShow(): Promise<ShowSummary | null> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  async getEpisodes(): Promise<EpisodeEntry[]> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  async getStream(): Promise<string> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  async getFeatured(): Promise<FeaturedPayload> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  async listFavorites(): Promise<ShowSummary[]> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  async setFavorite(): Promise<ShowSummary[]> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  async listHistory(): Promise<HistoryEntry[]> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  async recordPlayback(): Promise<HistoryEntry[]> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  async clearHistory(): Promise<HistoryEntry[]> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  async getSettings(): Promise<TurtleSettings> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  async updateSettings(): Promise<TurtleSettings> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  async getCacheStats(): Promise<CacheStats> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  async setCacheLimit(): Promise<CacheStats> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  async clearCache(): Promise<CacheStats> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  resolveImageUrl(imageKeyOrRemoteUrl: string | null | undefined): string {
    return imageKeyOrRemoteUrl ?? "";
  }

  async getAvailableThemes(): Promise<string[]> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  async getThemeCss(): Promise<string> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }

  async checkForUpdates(): Promise<UpdateCheckResult> {
    throw new Error(DIRECT_OPEN_MESSAGE);
  }
}

class StandaloneHttpAdapter implements TurtleRuntimeAdapter {
  private readonly apiBaseUrl: string;

  private readonly apiKey: string;

  private readonly imageBaseUrl: string;

  private readonly imageToken: string;

  private readonly showCache = new Map<string, ShowSummary>();

  constructor(port: string, key: string) {
    this.apiBaseUrl = `http://127.0.0.1:${port}/api`;
    this.apiKey = key;
    this.imageBaseUrl = `${this.apiBaseUrl}/image`;
    this.imageToken = key;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.apiKey,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.message ?? `Request failed with status ${response.status}`);
    }
    return data as T;
  }

  private rememberShows(shows: ShowSummary[]) {
    shows.forEach((show) => {
      this.showCache.set(show.showId, show);
    });
  }

  private async requestText(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        Authorization: this.apiKey,
      },
    });

    const body = await response.text();
    if (!response.ok) {
      try {
        const json = JSON.parse(body) as { message?: string };
        throw new Error(json.message ?? `Request failed with status ${response.status}`);
      } catch {
        throw new Error(body || `Request failed with status ${response.status}`);
      }
    }

    return body;
  }

  async bootstrap(): Promise<TurtleBootstrap> {
    const payload = await this.request<TurtleBootstrap>("/bootstrap");
    this.rememberShows(payload.favorites);
    return payload;
  }

  async search(query: string): Promise<ShowSummary[]> {
    const results = await this.request<SearchResult[]>(`/search?q=${encodeURIComponent(query)}`);
    const shows = results.map(createShowFromSearch);
    this.rememberShows(shows);
    return shows;
  }

  suggest(query: string): Promise<Suggestion[]> {
    return this.request<Suggestion[]>(`/suggest?q=${encodeURIComponent(query)}`);
  }

  async getShow(showId: string): Promise<ShowSummary | null> {
    return this.showCache.get(showId) ?? null;
  }

  getEpisodes(sourceId: string): Promise<EpisodeEntry[]> {
    return this.request<EpisodeEntry[]>(`/show-episodes?sourceId=${encodeURIComponent(sourceId)}`);
  }

  async getStream(episodeLink: string): Promise<string> {
    return normalizeStreamPayload(
      await this.request<unknown>(`/stream?link=${encodeURIComponent(episodeLink)}`),
    );
  }

  async getFeatured(): Promise<FeaturedPayload> {
    const payload = await this.request<FeaturedPayload>("/featured");
    this.rememberShows([payload.hero, ...payload.trending, ...payload.seasonal].filter(Boolean) as ShowSummary[]);
    return payload;
  }

  async listFavorites(): Promise<ShowSummary[]> {
    const favorites = await this.request<ShowSummary[]>("/favorites");
    this.rememberShows(favorites);
    return favorites;
  }

  async setFavorite(show: ShowSummary, isFavorite: boolean): Promise<ShowSummary[]> {
    const favorites = await this.request<ShowSummary[]>("/favorites", {
      body: JSON.stringify({ show, isFavorite }),
      method: "POST",
    });
    this.rememberShows(favorites);
    return favorites;
  }

  listHistory(): Promise<HistoryEntry[]> {
    return this.request<HistoryEntry[]>("/history");
  }

  recordPlayback(entry: HistoryEntry): Promise<HistoryEntry[]> {
    return this.request<HistoryEntry[]>("/history", {
      body: JSON.stringify(entry),
      method: "POST",
    });
  }

  clearHistory(): Promise<HistoryEntry[]> {
    return this.request<HistoryEntry[]>("/history", {
      method: "DELETE",
    });
  }

  getSettings(): Promise<TurtleSettings> {
    return this.request<TurtleSettings>("/settings");
  }

  updateSettings(patch: Partial<TurtleSettings>): Promise<TurtleSettings> {
    return this.request<TurtleSettings>("/settings", {
      body: JSON.stringify(patch),
      method: "POST",
    });
  }

  getCacheStats(): Promise<CacheStats> {
    return this.request<CacheStats>("/cache");
  }

  setCacheLimit(limitMb: number): Promise<CacheStats> {
    return this.request<CacheStats>("/cache", {
      body: JSON.stringify({ limitMb }),
      method: "POST",
    });
  }

  clearCache(): Promise<CacheStats> {
    return this.request<CacheStats>("/cache", {
      method: "DELETE",
    });
  }

  resolveImageUrl(imageKeyOrRemoteUrl: string | null | undefined): string {
    if (!imageKeyOrRemoteUrl) {
      return "";
    }
    return `${this.imageBaseUrl}?token=${encodeURIComponent(this.imageToken)}&src=${encodeURIComponent(imageKeyOrRemoteUrl)}`;
  }

  async getAvailableThemes(): Promise<string[]> {
    if (window.bergamot?.getAvailableThemes) {
      return window.bergamot.getAvailableThemes();
    }

    const text = await this.requestText(this.apiBaseUrl.replace(/\/api$/, "/themes/manifest.json"));
    const parsed = JSON.parse(text);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  }

  async getThemeCss(filename: string): Promise<string> {
    if (window.bergamot?.getThemeCss) {
      return window.bergamot.getThemeCss(filename);
    }

    return this.requestText(`${this.apiBaseUrl.replace(/\/api$/, "")}/themes/${encodeURIComponent(filename)}`);
  }

  checkForUpdates(): Promise<UpdateCheckResult> {
    return this.request<UpdateCheckResult>("/update/check");
  }
}

class GameletteBridgeAdapter implements TurtleRuntimeAdapter {
  private readonly showCache = new Map<string, ShowSummary>();

  private readonly store = new GameletteFallbackStore();

  private bridgeQueue = Promise.resolve();

  private currentRequest:
    | {
        action: keyof typeof LEGACY_ACTION_TO_RESULT_TYPE;
        requestId: string;
        reject: (error: Error) => void;
        resolve: (payload: unknown) => void;
        timeoutId: number;
      }
    | null = null;

  constructor() {
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") {
        return;
      }

      if (
        data.type === "TURTLE_RESULT"
        && typeof data.requestId === "string"
        && this.currentRequest?.requestId === data.requestId
      ) {
        const current = this.currentRequest;
        this.currentRequest = null;
        window.clearTimeout(current.timeoutId);
        if (data.ok === false) {
          current.reject(new Error(data.error?.message ?? `The Proteus bridge failed while handling ${current.action}.`));
        } else {
          current.resolve(data.payload);
        }
        return;
      }

      if (!this.currentRequest) {
        return;
      }

      if (data.type === LEGACY_ACTION_TO_RESULT_TYPE[this.currentRequest.action]) {
        const current = this.currentRequest;
        this.currentRequest = null;
        window.clearTimeout(current.timeoutId);
        current.resolve(data.payload);
        return;
      }

      if (data.type === "TURTLE_ERROR") {
        const current = this.currentRequest;
        this.currentRequest = null;
        window.clearTimeout(current.timeoutId);
        current.reject(new Error(data.payload?.message ?? "The Proteus bridge returned an error."));
      }
    });
  }

  private async invokeLegacy(action: keyof typeof LEGACY_ACTION_TO_RESULT_TYPE, payload: unknown): Promise<unknown> {
    const run = () =>
      new Promise<unknown>((resolve, reject) => {
        const requestId = `turtle-${action}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const timeoutId = window.setTimeout(() => {
          if (this.currentRequest?.action === action) {
            this.currentRequest = null;
            reject(new Error(`The Proteus bridge timed out while handling ${action}.`));
          }
        }, 30000);
        this.currentRequest = { action, requestId, resolve, reject, timeoutId };
        window.parent.postMessage({ type: "TURTLE_CMD", requestId, action, payload }, "*");
      });

    const pending = this.bridgeQueue.then(run, run);
    this.bridgeQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private rememberShows(shows: ShowSummary[]) {
    shows.forEach((show) => {
      this.showCache.set(show.showId, show);
    });
  }

  async bootstrap(): Promise<TurtleBootstrap> {
    const settings = this.store.getSettings();
    const favorites = this.store.listFavorites();
    const history = this.store.listHistory();
    this.rememberShows(favorites);

    return {
      runtimeMode: "gamelette",
      apiBaseUrl: "",
      imageBaseUrl: "",
      imageToken: "",
      settings,
      favorites,
      history,
      resumeItems: history.filter((entry) => entry.progressSeconds > 0),
      cacheStats: createEmptyCacheStats(settings.cacheLimitMb),
    };
  }

  async search(query: string): Promise<ShowSummary[]> {
    const payload = await this.invokeLegacy("search", query);
    const shows = (Array.isArray(payload) ? payload : []).map((result) => createShowFromSearch(result as SearchResult));
    this.rememberShows(shows);
    return shows;
  }

  suggest(query: string): Promise<Suggestion[]> {
    return fetchAniListSuggestions(query);
  }

  async getShow(showId: string): Promise<ShowSummary | null> {
    if (this.showCache.has(showId)) {
      return this.showCache.get(showId) ?? null;
    }

    if (showId.startsWith("anilist:")) {
      const [result] = await fetchAniListSuggestions(showId.replace("anilist:", ""));
      if (result) {
        return {
          showId,
          title: result.english || result.romaji,
          imgUrl: "",
          anilistId: result.id,
          searchTitle: result.searchTitle,
        };
      }
    }

    return null;
  }

  async getEpisodes(sourceId: string): Promise<EpisodeEntry[]> {
    const payload = await this.invokeLegacy("episodes", sourceId);
    const historyByLink = new Map(this.store.listHistory().map((entry) => [entry.episodeLink, entry]));
    return (Array.isArray(payload) ? payload : []).map((item) => {
      const episode = item as EpisodeEntry;
      const resume = historyByLink.get(episode.link);
      return {
        epNum: episode.epNum,
        link: episode.link,
        resumeSeconds: resume?.progressSeconds ?? 0,
        durationSeconds: resume?.durationSeconds ?? 0,
      };
    });
  }

  async getStream(episodeLink: string): Promise<string> {
    return normalizeStreamPayload(await this.invokeLegacy("stream", episodeLink));
  }

  getFeatured(): Promise<FeaturedPayload> {
    return fetchAniListFeatured(this.store.listHistory());
  }

  async listFavorites(): Promise<ShowSummary[]> {
    const favorites = this.store.listFavorites();
    this.rememberShows(favorites);
    return favorites;
  }

  async setFavorite(show: ShowSummary, isFavorite: boolean): Promise<ShowSummary[]> {
    const current = this.store.listFavorites();
    const next = isFavorite
      ? [...current.filter((item) => item.showId !== show.showId), show]
      : current.filter((item) => item.showId !== show.showId);
    this.store.setFavorites(next);
    this.rememberShows(next);
    return next;
  }

  async listHistory(): Promise<HistoryEntry[]> {
    return this.store.listHistory();
  }

  async recordPlayback(entry: HistoryEntry): Promise<HistoryEntry[]> {
    const current = this.store.listHistory();
    const filtered = current.filter(
      (candidate) => !(candidate.showId === entry.showId && candidate.episodeLink === entry.episodeLink),
    );
    const next = [{ ...entry, watchedAt: Date.now() }, ...filtered].slice(0, 200);
    this.store.setHistory(next);
    return next;
  }

  async clearHistory(): Promise<HistoryEntry[]> {
    return this.store.setHistory([]);
  }

  async getSettings(): Promise<TurtleSettings> {
    return this.store.getSettings();
  }

  async updateSettings(patch: Partial<TurtleSettings>): Promise<TurtleSettings> {
    return this.store.setSettings({
      ...this.store.getSettings(),
      ...patch,
    });
  }

  async getCacheStats(): Promise<CacheStats> {
    const settings = this.store.getSettings();
    return createEmptyCacheStats(settings.cacheLimitMb);
  }

  async setCacheLimit(limitMb: number): Promise<CacheStats> {
    const settings = await this.updateSettings({ cacheLimitMb: limitMb });
    return createEmptyCacheStats(settings.cacheLimitMb);
  }

  async clearCache(): Promise<CacheStats> {
    return createEmptyCacheStats(this.store.getSettings().cacheLimitMb);
  }

  resolveImageUrl(imageKeyOrRemoteUrl: string | null | undefined): string {
    return imageKeyOrRemoteUrl ?? "";
  }

  async getAvailableThemes(): Promise<string[]> {
    return [];
  }

  async getThemeCss(): Promise<string> {
    return "";
  }

  async checkForUpdates(): Promise<UpdateCheckResult> {
    const settings = await this.updateSettings({ lastUpdateCheckAt: Date.now() });
    return {
      status: "todo",
      message: "Update checks will be provided by Proteus once the upstream repository is configured.",
      checkedAt: settings.lastUpdateCheckAt ?? Date.now(),
      repoUrl: settings.updateRepoUrl,
    };
  }
}

export function createRuntimeAdapter(): TurtleRuntimeAdapter {
  if (__TURTLE_TARGET__ === "standalone") {
    const params = new URLSearchParams(window.location.search);
    const port = params.get("api_port")?.trim() ?? "";
    const key = params.get("api_key")?.trim() ?? "";

    if (port && key) {
      const cleanUrl = `${window.location.pathname}${window.location.hash}`;
      window.history.replaceState({}, document.title, cleanUrl);
      return new StandaloneHttpAdapter(port, key);
    }

    window.alert(DIRECT_OPEN_MESSAGE);
    return new InvalidStandaloneAdapter();
  }

  return new GameletteBridgeAdapter();
}
