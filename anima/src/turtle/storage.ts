import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { getTurtleStateFilePath } from "./paths.js";
import { type HistoryEntry, type ShowSummary, type TurtleSettings, type TurtleStoreState } from "./types.js";

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

const DEFAULT_STATE: TurtleStoreState = {
  favorites: {},
  history: [],
  settings: DEFAULT_SETTINGS,
};

const HISTORY_LIMIT = 200;

function normalizeShowSummary(show: ShowSummary): ShowSummary {
  return {
    showId: show.showId,
    title: show.title,
    subtitle: show.subtitle ?? null,
    description: show.description ?? null,
    imgUrl: show.imgUrl,
    cachedImgUrl: show.cachedImgUrl ?? null,
    anilistId: show.anilistId ?? null,
    badge: show.badge ?? null,
    bannerImage: show.bannerImage ?? null,
    searchTitle: show.searchTitle ?? null,
    sourceId: show.sourceId ?? null,
  };
}

function normalizeHistoryEntry(entry: HistoryEntry): HistoryEntry {
  return {
    showId: entry.showId,
    showTitle: entry.showTitle,
    searchTitle: entry.searchTitle ?? null,
    episodeLink: entry.episodeLink,
    epNum: entry.epNum,
    progressSeconds: Math.max(0, Math.floor(entry.progressSeconds || 0)),
    durationSeconds: Math.max(0, Math.floor(entry.durationSeconds || 0)),
    watchedAt: Number.isFinite(entry.watchedAt) ? entry.watchedAt : Date.now(),
    imgUrl: entry.imgUrl,
    anilistId: entry.anilistId ?? null,
    sourceId: entry.sourceId ?? null,
  };
}

export class TurtleStorage {
  private readonly statePath = getTurtleStateFilePath();

  async load(): Promise<TurtleStoreState> {
    try {
      const raw = await readFile(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<TurtleStoreState>;

      const favorites = Object.fromEntries(
        Object.values(parsed.favorites ?? {}).flatMap((show) =>
          show?.showId ? [[show.showId, normalizeShowSummary(show)]] : [],
        ),
      );

      return {
        favorites,
        history: Array.isArray(parsed.history) ? parsed.history.map(normalizeHistoryEntry) : [],
        settings: {
          ...DEFAULT_SETTINGS,
          ...(parsed.settings ?? {}),
        },
      };
    } catch {
      return {
        ...DEFAULT_STATE,
        favorites: {},
        history: [],
        settings: { ...DEFAULT_SETTINGS },
      };
    }
  }

  async save(state: TurtleStoreState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });

    const normalized: TurtleStoreState = {
      favorites: Object.fromEntries(
        Object.values(state.favorites).map((show) => [show.showId, normalizeShowSummary(show)]),
      ),
      history: state.history.map(normalizeHistoryEntry).slice(0, HISTORY_LIMIT),
      settings: {
        ...DEFAULT_SETTINGS,
        ...state.settings,
      },
    };

    const tempPath = `${this.statePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(normalized, null, 2), "utf8");
    await rename(tempPath, this.statePath);
  }

  async update(mutator: (state: TurtleStoreState) => TurtleStoreState | Promise<TurtleStoreState>): Promise<TurtleStoreState> {
    const nextState = await mutator(await this.load());
    await this.save(nextState);
    return nextState;
  }
}
