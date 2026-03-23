import { getEpisodes } from "../scraper.js";
import { fetchFeaturedShows } from "./featured.js";
import { TurtleImageCache } from "./cache.js";
import { TurtleStorage } from "./storage.js";
import {
  type CacheStats,
  type EpisodeEntry,
  type FeaturedPayload,
  type HistoryEntry,
  type ShowSummary,
  type TurtleBootstrap,
  type TurtleSettings,
  type UpdateCheckResult,
} from "./types.js";

function mergeResumeIntoEpisodes(episodes: Awaited<ReturnType<typeof getEpisodes>>, history: HistoryEntry[]): EpisodeEntry[] {
  const historyByLink = new Map(history.map((entry) => [entry.episodeLink, entry]));
  return episodes.map((episode) => {
    const resume = historyByLink.get(episode.link);
    return {
      epNum: episode.epNum,
      link: episode.link,
      resumeSeconds: resume?.progressSeconds ?? 0,
      durationSeconds: resume?.durationSeconds ?? 0,
    };
  });
}

function toResumeItems(history: HistoryEntry[]): HistoryEntry[] {
  return history
    .filter((entry) => entry.progressSeconds > 0)
    .sort((left, right) => right.watchedAt - left.watchedAt);
}

export class TurtleService {
  private readonly storage = new TurtleStorage();

  private readonly cache = new TurtleImageCache();

  async getBootstrap(apiBaseUrl: string, imageBaseUrl: string, imageToken: string): Promise<TurtleBootstrap> {
    const state = await this.storage.load();
    const cacheStats = await this.getCacheStats();

    return {
      runtimeMode: "standalone",
      apiBaseUrl,
      imageBaseUrl,
      imageToken,
      settings: state.settings,
      favorites: Object.values(state.favorites),
      history: state.history,
      resumeItems: toResumeItems(state.history),
      cacheStats,
    };
  }

  async getFeatured(): Promise<FeaturedPayload> {
    const state = await this.storage.load();
    return fetchFeaturedShows(state.history);
  }

  async listFavorites(): Promise<ShowSummary[]> {
    const state = await this.storage.load();
    return Object.values(state.favorites);
  }

  async setFavorite(show: ShowSummary, isFavorite: boolean): Promise<ShowSummary[]> {
    const state = await this.storage.update((current) => {
      const nextFavorites = { ...current.favorites };
      if (isFavorite) {
        nextFavorites[show.showId] = show;
      } else {
        delete nextFavorites[show.showId];
      }

      return {
        ...current,
        favorites: nextFavorites,
      };
    });

    return Object.values(state.favorites);
  }

  async listHistory(): Promise<HistoryEntry[]> {
    const state = await this.storage.load();
    return state.history;
  }

  async recordPlayback(entry: HistoryEntry): Promise<HistoryEntry[]> {
    const state = await this.storage.update((current) => {
      const nextEntry: HistoryEntry = {
        ...entry,
        watchedAt: Number.isFinite(entry.watchedAt) ? entry.watchedAt : Date.now(),
      };
      const filtered = current.history.filter(
        (candidate) => !(candidate.showId === entry.showId && candidate.episodeLink === entry.episodeLink),
      );
      return {
        ...current,
        history: [nextEntry, ...filtered].slice(0, 200),
      };
    });

    return state.history;
  }

  async clearHistory(): Promise<HistoryEntry[]> {
    const state = await this.storage.update((current) => ({
      ...current,
      history: [],
    }));
    return state.history;
  }

  async getSettings(): Promise<TurtleSettings> {
    const state = await this.storage.load();
    return state.settings;
  }

  async updateSettings(patch: Partial<TurtleSettings>): Promise<TurtleSettings> {
    const state = await this.storage.update((current) => ({
      ...current,
      settings: {
        ...current.settings,
        ...patch,
      },
    }));
    return state.settings;
  }

  async getEpisodesForShow(sourceId: string): Promise<EpisodeEntry[]> {
    const state = await this.storage.load();
    return mergeResumeIntoEpisodes(await getEpisodes(sourceId), state.history);
  }

  async getCacheStats(): Promise<CacheStats> {
    const settings = await this.getSettings();
    return this.cache.getStats(settings.cacheLimitMb * 1024 * 1024);
  }

  async setCacheLimit(limitMb: number): Promise<CacheStats> {
    await this.updateSettings({ cacheLimitMb: Math.max(32, Math.floor(limitMb)) });
    return this.getCacheStats();
  }

  async clearCache(): Promise<CacheStats> {
    await this.cache.clear();
    return this.getCacheStats();
  }

  async ensureImage(src: string) {
    const settings = await this.getSettings();
    return this.cache.ensure(src, settings.cacheLimitMb * 1024 * 1024);
  }

  createImageStream(entry: Awaited<ReturnType<TurtleService["ensureImage"]>>) {
    return this.cache.createStream(entry);
  }

  async checkForUpdates(): Promise<UpdateCheckResult> {
    const settings = await this.updateSettings({
      lastUpdateCheckAt: Date.now(),
    });

    return {
      status: "todo",
      message: "Update checks are scaffolded, but the release repository has not been configured yet.",
      checkedAt: settings.lastUpdateCheckAt ?? Date.now(),
      repoUrl: settings.updateRepoUrl,
    };
  }
}
