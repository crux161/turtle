export interface SearchResult {
  id: string;
  title: string;
  img: string;
}

export interface Suggestion {
  id: number;
  romaji: string;
  english: string | null;
  searchTitle: string;
}

export interface EpisodeEntry {
  epNum: number;
  link: string;
  resumeSeconds?: number;
  durationSeconds?: number;
}

export interface ShowSummary {
  showId: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  imgUrl: string;
  cachedImgUrl?: string | null;
  anilistId?: number | null;
  badge?: string | null;
  bannerImage?: string | null;
  searchTitle?: string | null;
  sourceId?: string | null;
}

export interface HistoryEntry {
  showId: string;
  showTitle: string;
  searchTitle?: string | null;
  episodeLink: string;
  epNum: number;
  progressSeconds: number;
  durationSeconds: number;
  watchedAt: number;
  imgUrl: string;
  anilistId?: number | null;
  sourceId?: string | null;
}

export interface TurtleSettings {
  cacheLimitMb: number;
  uiScale: number;
  autoplayNext: boolean;
  reduceMotion: boolean;
  compactDensity: boolean;
  themeFile: string;
  themeMode: "dark" | "light";
  updateRepoUrl: string | null;
  lastUpdateCheckAt: number | null;
}

export interface CacheStats {
  entryCount: number;
  totalBytes: number;
  limitBytes: number;
  utilization: number;
}

export interface FeaturedPayload {
  hero: ShowSummary | null;
  continueWatching: HistoryEntry[];
  trending: ShowSummary[];
  seasonal: ShowSummary[];
  updatedAt: number;
}

export interface TurtleBootstrap {
  runtimeMode: "standalone" | "gamelette";
  apiBaseUrl: string;
  imageBaseUrl: string;
  imageToken: string;
  settings: TurtleSettings;
  favorites: ShowSummary[];
  history: HistoryEntry[];
  resumeItems: HistoryEntry[];
  cacheStats: CacheStats;
}

export interface UpdateCheckResult {
  status: "todo";
  message: string;
  checkedAt: number;
  repoUrl: string | null;
}

export interface DesktopWindowState {
  isDesktop: boolean;
  isMaximized: boolean;
  isFullScreen: boolean;
}

export interface ProviderOption {
  kind: string;
  label: string;
}

export interface TurtleRuntimeAdapter {
  bootstrap(): Promise<TurtleBootstrap>;
  search(query: string): Promise<ShowSummary[]>;
  suggest(query: string): Promise<Suggestion[]>;
  getShow(showId: string): Promise<ShowSummary | null>;
  getEpisodes(sourceId: string): Promise<EpisodeEntry[]>;
  getStream(episodeLink: string, preferredKind?: string): Promise<string>;
  getProviders(episodeLink: string): Promise<ProviderOption[]>;
  getFeatured(): Promise<FeaturedPayload>;
  listFavorites(): Promise<ShowSummary[]>;
  setFavorite(show: ShowSummary, isFavorite: boolean): Promise<ShowSummary[]>;
  listHistory(): Promise<HistoryEntry[]>;
  recordPlayback(entry: HistoryEntry): Promise<HistoryEntry[]>;
  clearHistory(): Promise<HistoryEntry[]>;
  getSettings(): Promise<TurtleSettings>;
  updateSettings(patch: Partial<TurtleSettings>): Promise<TurtleSettings>;
  getCacheStats(): Promise<CacheStats>;
  setCacheLimit(limitMb: number): Promise<CacheStats>;
  clearCache(): Promise<CacheStats>;
  resolveImageUrl(imageKeyOrRemoteUrl: string | null | undefined): string;
  getAvailableThemes(): Promise<string[]>;
  getThemeCss(filename: string): Promise<string>;
  checkForUpdates(): Promise<UpdateCheckResult>;
}

declare const __TURTLE_TARGET__: "standalone" | "gamelette";
