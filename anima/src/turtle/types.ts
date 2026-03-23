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

export interface EpisodeEntry {
  epNum: number;
  link: string;
  resumeSeconds?: number;
  durationSeconds?: number;
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

export interface TurtleBootstrap {
  runtimeMode: "standalone";
  apiBaseUrl: string;
  imageBaseUrl: string;
  imageToken: string;
  settings: TurtleSettings;
  favorites: ShowSummary[];
  history: HistoryEntry[];
  resumeItems: HistoryEntry[];
  cacheStats: CacheStats;
}

export interface FeaturedPayload {
  hero: ShowSummary | null;
  continueWatching: HistoryEntry[];
  trending: ShowSummary[];
  seasonal: ShowSummary[];
  updatedAt: number;
}

export interface UpdateCheckResult {
  status: "todo";
  message: string;
  checkedAt: number;
  repoUrl: string | null;
}

export interface TurtleStoreState {
  favorites: Record<string, ShowSummary>;
  history: HistoryEntry[];
  settings: TurtleSettings;
}

export interface CacheIndexEntry {
  src: string;
  contentType: string;
  extension: string;
  fileName: string;
  size: number;
  createdAt: number;
  lastAccessedAt: number;
}

export interface CacheIndexState {
  entries: Record<string, CacheIndexEntry>;
}
