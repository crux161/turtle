import Hls from "hls.js";
import {
  Bookmark,
  Clock3,
  ExternalLink,
  Heart,
  Home,
  LoaderCircle,
  Maximize2,
  Minus,
  Moon,
  Palette,
  Pause,
  Play,
  Square,
  Search,
  Settings2,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  RotateCw,
  Sparkles,
  Star,
  Sun,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import React, {
  startTransition,
  type CSSProperties,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { createRuntimeAdapter } from "./runtime";
import {
  type DesktopWindowState,
  type CacheStats,
  type EpisodeEntry,
  type FeaturedPayload,
  type HistoryEntry,
  type ShowSummary,
  type TurtleRuntimeAdapter,
  type TurtleSettings,
  type UpdateCheckResult,
} from "./types";

type PageId = "featured" | "my-list" | "history" | "settings" | "show";

const NAV_ITEMS: Array<{
  id: Exclude<PageId, "show">;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
}> = [
  { id: "featured", icon: Sparkles, label: "Featured", hint: "Discovery + continue" },
  { id: "my-list", icon: Heart, label: "My List", hint: "Saved shows" },
  { id: "history", icon: Clock3, label: "History", hint: "Resume episodes" },
  { id: "settings", icon: Settings2, label: "Settings", hint: "Cache + playback" },
];

function parseLocation(): { page: PageId; showId: string | null } {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (!hash) {
    return { page: "featured", showId: null };
  }

  const [head, tail] = hash.split("/");
  if (head === "show" && tail) {
    return { page: "show", showId: decodeURIComponent(tail) };
  }

  if (head === "my-list" || head === "history" || head === "settings" || head === "featured") {
    return { page: head, showId: null };
  }

  return { page: "featured", showId: null };
}

function navigateTo(page: PageId, showId?: string | null): void {
  const nextHash = page === "show" && showId
    ? `#/show/${encodeURIComponent(showId)}`
    : `#/${page}`;
  window.history.pushState({}, "", nextHash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function formatDuration(value: number): string {
  const safe = Math.max(0, Math.floor(value));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatRelativeTime(value: number): string {
  const diffMinutes = Math.max(0, Math.floor((Date.now() - value) / 60000));
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes > 0 ? 1 : 0)} MB`;
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isHlsStream(url: string): boolean {
  return /\.m3u8(?:$|\?)/i.test(url);
}

function formatThemeName(filename: string): string {
  return filename
    .replace(/\.theme\.css$/i, "")
    .replace(/\.css$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

function formatQualityLabel(height: number): string {
  const safe = Math.max(0, Math.round(height));
  if (!safe) {
    return "Auto";
  }

  const targets = [2160, 1440, 1080, 720, 480, 360];
  const closest = targets.reduce((best, candidate) =>
    Math.abs(candidate - safe) < Math.abs(best - safe) ? candidate : best, targets[0]);

  return `${closest}p`;
}

export function TurtleApp() {
  const runtime = useMemo<TurtleRuntimeAdapter>(() => createRuntimeAdapter(), []);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewerSurfaceRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playbackSaveTimerRef = useRef<number | null>(null);
  const fullscreenControlsTimerRef = useRef<number | null>(null);

  const [{ page, showId }, setLocationState] = useState(() => parseLocation());
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [runtimeMode, setRuntimeMode] = useState<"standalone" | "gamelette">("standalone");
  const [statusLabel, setStatusLabel] = useState("Booting Turtle");
  const [errorMessage, setErrorMessage] = useState("");
  const [featured, setFeatured] = useState<FeaturedPayload | null>(null);
  const [favorites, setFavorites] = useState<ShowSummary[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [settings, setSettings] = useState<TurtleSettings | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ShowSummary[]>([]);
  const [suggestions, setSuggestions] = useState<Array<{ english: string | null; id: number; romaji: string; searchTitle: string }>>([]);
  const [showMap, setShowMap] = useState<Record<string, ShowSummary>>({});
  const [activeShow, setActiveShow] = useState<ShowSummary | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeEntry[]>([]);
  const [selectedEpisode, setSelectedEpisode] = useState<EpisodeEntry | null>(null);
  const [currentStreamUrl, setCurrentStreamUrl] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [volumeLevel, setVolumeLevel] = useState(0.85);
  const [busyAction, setBusyAction] = useState<string>("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [availableThemes, setAvailableThemes] = useState<string[]>([]);
  const [themeCss, setThemeCss] = useState("");
  const [windowState, setWindowState] = useState<DesktopWindowState>({
    isDesktop: false,
    isMaximized: false,
  });
  const [isPlayerFullscreen, setIsPlayerFullscreen] = useState(false);
  const [showFullscreenControls, setShowFullscreenControls] = useState(true);
  const [qualityLabel, setQualityLabel] = useState("Auto");

  const deferredSearchQuery = useDeferredValue(searchQuery);
  const progressPercent = durationSeconds > 0 ? (playbackSeconds / durationSeconds) * 100 : 0;
  const favoriteIds = useMemo(() => new Set(favorites.map((item) => item.showId)), [favorites]);
  const sceneStyle = useMemo(
    () => ({ "--ui-scale": String(settings?.uiScale ?? 1) }) as CSSProperties,
    [settings?.uiScale],
  );
  const themeClass = settings?.themeMode === "light" ? "theme-light" : "theme-dark";

  useEffect(() => {
    const handleHashChange = () => {
      setLocationState(parseLocation());
    };

    window.addEventListener("hashchange", handleHashChange);
    if (!window.location.hash) {
      navigateTo("featured");
    }

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const bootstrap = await runtime.bootstrap();
        if (!active) return;

        startTransition(() => {
          setRuntimeMode(bootstrap.runtimeMode);
          setFavorites(bootstrap.favorites);
          setHistory(bootstrap.history);
          setSettings(bootstrap.settings);
          setCacheStats(bootstrap.cacheStats);
          setShowMap((current) => {
            const next = { ...current };
            bootstrap.favorites.forEach((show) => {
              next[show.showId] = show;
            });
            return next;
          });
          setBootstrapReady(true);
          setStatusLabel(bootstrap.runtimeMode === "standalone" ? "Standalone ready" : "Gamelette ready");
        });

        const featuredPayload = await runtime.getFeatured();
        if (!active) return;
        startTransition(() => {
          setFeatured(featuredPayload);
          setShowMap((current) => {
            const next = { ...current };
            [featuredPayload.hero, ...featuredPayload.trending, ...featuredPayload.seasonal]
              .filter(Boolean)
              .forEach((show) => {
                next[(show as ShowSummary).showId] = show as ShowSummary;
              });
            return next;
          });
        });
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Failed to initialize Turtle.";
        setErrorMessage(message);
        setStatusLabel("Boot failed");
      }
    })();

    return () => {
      active = false;
    };
  }, [runtime]);

  useEffect(() => {
    if (!bootstrapReady) {
      return;
    }

    const trimmed = deferredSearchQuery.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      void runtime
        .suggest(trimmed)
        .then((items) => setSuggestions(items))
        .catch(() => setSuggestions([]));
    }, 280);

    return () => window.clearTimeout(timeout);
  }, [bootstrapReady, deferredSearchQuery, runtime]);

  useEffect(() => {
    if (!bootstrapReady) {
      return;
    }

    let active = true;

    void runtime
      .getAvailableThemes()
      .then((themes) => {
        if (active) {
          setAvailableThemes(themes);
        }
      })
      .catch(() => {
        if (active) {
          setAvailableThemes([]);
        }
      });

    return () => {
      active = false;
    };
  }, [bootstrapReady, runtime]);

  useEffect(() => {
    if (!bootstrapReady || !settings?.themeFile) {
      return;
    }

    let active = true;

    void runtime
      .getThemeCss(settings.themeFile)
      .then((css) => {
        if (active) {
          setThemeCss(css);
        }
      })
      .catch(() => {
        if (active) {
          setThemeCss("");
        }
      });

    return () => {
      active = false;
    };
  }, [bootstrapReady, runtime, settings?.themeFile]);

  useEffect(() => {
    let active = true;
    const windowBridge = window.api?.window;

    void windowBridge?.getState?.()
      .then((state) => {
        if (active) {
          setWindowState(state);
        }
      })
      .catch(() => undefined);

    const unsubscribe = windowBridge?.onStateChanged?.((state) => {
      setWindowState(state);
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    videoRef.current.volume = volumeLevel;
  }, [volumeLevel]);

  useEffect(() => {
    if (page !== "show" || !showId) {
      return;
    }

    if (activeShow?.showId === showId) {
      return;
    }

    const show = showMap[showId];
    if (show) {
      void openShow(show, { push: false });
    }
  }, [activeShow?.showId, page, showId, showMap]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const handleTimeUpdate = () => {
      setPlaybackSeconds(video.currentTime);
      setDurationSeconds(Number.isFinite(video.duration) ? video.duration : durationSeconds);
      schedulePlaybackSave();
    };

    const handleLoadedMetadata = () => {
      setDurationSeconds(Number.isFinite(video.duration) ? video.duration : 0);
      setQualityLabel(formatQualityLabel(video.videoHeight));
      if (selectedEpisode?.resumeSeconds && Math.abs(video.currentTime - selectedEpisode.resumeSeconds) > 1) {
        video.currentTime = selectedEpisode.resumeSeconds;
      }
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => {
      setIsPlaying(false);
      void persistPlayback();
    };
    const handleEnded = () => {
      setIsPlaying(false);
      void persistPlayback(true);
      if (settings?.autoplayNext) {
        const currentIndex = episodes.findIndex((episode) => episode.link === selectedEpisode?.link);
        const nextEpisode = currentIndex >= 0 ? episodes[currentIndex + 1] : null;
        if (nextEpisode) {
          void playEpisode(nextEpisode);
        }
      }
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
    };
  }, [durationSeconds, episodes, selectedEpisode, settings?.autoplayNext]);

  useEffect(() => {
    const beforeUnload = () => {
      void persistPlayback();
    };

    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  });

  useEffect(() => () => {
    if (playbackSaveTimerRef.current) {
      window.clearTimeout(playbackSaveTimerRef.current);
      playbackSaveTimerRef.current = null;
    }

    if (fullscreenControlsTimerRef.current) {
      window.clearTimeout(fullscreenControlsTimerRef.current);
      fullscreenControlsTimerRef.current = null;
    }

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = document.fullscreenElement === viewerSurfaceRef.current;
      setIsPlayerFullscreen(active);
      setShowFullscreenControls(true);

      if (!active && fullscreenControlsTimerRef.current) {
        window.clearTimeout(fullscreenControlsTimerRef.current);
        fullscreenControlsTimerRef.current = null;
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!isPlayerFullscreen) {
      setShowFullscreenControls(true);
      if (fullscreenControlsTimerRef.current) {
        window.clearTimeout(fullscreenControlsTimerRef.current);
        fullscreenControlsTimerRef.current = null;
      }
      return;
    }

    revealFullscreenControls();
  }, [isPlayerFullscreen, isPlaying]);

  function syncHistoryState(nextHistory: HistoryEntry[]) {
    setHistory(nextHistory);
    setFeatured((current) => current
      ? {
          ...current,
          continueWatching: nextHistory
            .filter((entry) => entry.progressSeconds > 0)
            .sort((left, right) => right.watchedAt - left.watchedAt)
            .slice(0, 8),
        }
      : current);
  }

  function resetPlaybackSession() {
    if (playbackSaveTimerRef.current) {
      window.clearTimeout(playbackSaveTimerRef.current);
      playbackSaveTimerRef.current = null;
    }

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }

    setSelectedEpisode(null);
    setCurrentStreamUrl("");
    setIsPlaying(false);
    setPlaybackSeconds(0);
    setDurationSeconds(0);
    setQualityLabel("Auto");
  }

  function revealFullscreenControls() {
    setShowFullscreenControls(true);

    if (fullscreenControlsTimerRef.current) {
      window.clearTimeout(fullscreenControlsTimerRef.current);
      fullscreenControlsTimerRef.current = null;
    }

    if (!isPlayerFullscreen || !isPlaying) {
      return;
    }

    fullscreenControlsTimerRef.current = window.setTimeout(() => {
      setShowFullscreenControls(false);
    }, 2200);
  }

  function handleSeek(nextValue: number) {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.currentTime = nextValue;
    setPlaybackSeconds(nextValue);
    revealFullscreenControls();
  }

  function handleVolumeChange(nextValue: number) {
    setVolumeLevel(nextValue);
    revealFullscreenControls();
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    revealFullscreenControls();
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }

  function playPreviousEpisode() {
    const index = episodes.findIndex((episode) => episode.link === selectedEpisode?.link);
    if (index > 0) {
      void playEpisode(episodes[index - 1]);
    }
  }

  function playNextEpisode() {
    const index = episodes.findIndex((episode) => episode.link === selectedEpisode?.link);
    if (index >= 0 && index < episodes.length - 1) {
      void playEpisode(episodes[index + 1]);
    }
  }

  async function togglePlayerFullscreen() {
    const surface = viewerSurfaceRef.current;
    if (!surface) {
      return;
    }

    revealFullscreenControls();

    if (document.fullscreenElement === surface) {
      await document.exitFullscreen();
      return;
    }

    if (typeof surface.requestFullscreen === "function") {
      await surface.requestFullscreen();
    }
  }

  async function openShow(
    show: ShowSummary,
    options: { push?: boolean } = {},
  ): Promise<{ episodes: EpisodeEntry[]; show: ShowSummary } | null> {
    setErrorMessage("");
    setBusyAction(`Loading ${show.title}`);
    setStatusLabel(`Opening ${show.title}`);

    try {
      const resolvedShow = await ensureSourceId(show);
      const nextEpisodes = await runtime.getEpisodes(resolvedShow.sourceId!);

      if (activeShow?.showId !== resolvedShow.showId) {
        resetPlaybackSession();
      }

      startTransition(() => {
        setActiveShow(resolvedShow);
        setEpisodes(nextEpisodes);
        setShowMap((current) => ({ ...current, [resolvedShow.showId]: resolvedShow }));
        setBusyAction("");
        setStatusLabel(`Ready: ${resolvedShow.title}`);
        if (options.push !== false) {
          navigateTo("show", resolvedShow.showId);
        }
      });

      return {
        episodes: nextEpisodes,
        show: resolvedShow,
      };
    } catch (error) {
      setBusyAction("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to open this show.");
      setStatusLabel("Show load failed");
      return null;
    }
  }

  async function openPlaybackEntry(entry: HistoryEntry) {
    const fallbackShow = showMap[entry.showId] ?? {
      showId: entry.showId,
      title: entry.showTitle,
      imgUrl: entry.imgUrl,
      searchTitle: entry.searchTitle || entry.showTitle,
      sourceId: entry.sourceId || null,
      anilistId: entry.anilistId || null,
    };

    const opened = await openShow(fallbackShow);
    if (!opened) {
      return;
    }

    const matchingEpisode = opened.episodes.find((episode) => episode.link === entry.episodeLink);
    if (!matchingEpisode) {
      return;
    }

    await playEpisode({
      ...matchingEpisode,
      durationSeconds: entry.durationSeconds || matchingEpisode.durationSeconds,
      resumeSeconds: entry.progressSeconds || matchingEpisode.resumeSeconds,
    });
  }

  async function ensureSourceId(show: ShowSummary): Promise<ShowSummary> {
    if (show.sourceId) {
      return show;
    }

    const attemptedQueries = new Set<string>();
    const preferredSuggestions = await runtime
      .suggest(show.searchTitle || show.title)
      .catch(() => []);

    const matchingSuggestion = show.anilistId
      ? preferredSuggestions.find((item) => item.id === show.anilistId) ?? null
      : preferredSuggestions[0] ?? null;

    const candidateQueries = [
      show.searchTitle,
      show.title,
      matchingSuggestion?.searchTitle,
      matchingSuggestion?.romaji,
      matchingSuggestion?.english,
      ...preferredSuggestions.flatMap((item) => [item.searchTitle, item.romaji, item.english]),
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

    for (const query of candidateQueries) {
      const normalizedQuery = query.trim();
      if (attemptedQueries.has(normalizedQuery)) {
        continue;
      }

      attemptedQueries.add(normalizedQuery);

      const results = await runtime.search(normalizedQuery);
      const exact = results.find((item) => normalizeTitle(item.title) === normalizeTitle(show.title))
        ?? results.find((item) => normalizeTitle(item.title) === normalizeTitle(show.searchTitle || ""))
        ?? results.find((item) => normalizeTitle(item.title) === normalizeTitle(matchingSuggestion?.romaji || ""))
        ?? results.find((item) => normalizeTitle(item.title) === normalizeTitle(matchingSuggestion?.english || ""));
      const match = exact ?? results[0];

      if (match?.sourceId) {
        return {
          ...show,
          sourceId: match.sourceId,
        };
      }
    }

    throw new Error(`Unable to resolve a playable source for ${show.title}.`);
  }

  async function handleSearchSubmit(nextQuery = searchQuery) {
    const trimmed = nextQuery.trim();
    if (!trimmed) {
      return;
    }

    setBusyAction(`Searching for ${trimmed}`);
    setStatusLabel(`Searching ${trimmed}`);
    setShowSearchResults(true);
    setSuggestions([]);

    try {
      const results = await runtime.search(trimmed);
      startTransition(() => {
        setSearchQuery(trimmed);
        setSearchResults(results);
        setShowMap((current) => {
          const next = { ...current };
          results.forEach((show) => {
            next[show.showId] = show;
          });
          return next;
        });
        setBusyAction("");
        setStatusLabel(`Found ${results.length} matches`);
        navigateTo("featured");
      });
    } catch (error) {
      setBusyAction("");
      setErrorMessage(error instanceof Error ? error.message : "Search failed.");
      setStatusLabel("Search failed");
    }
  }

  function schedulePlaybackSave() {
    if (playbackSaveTimerRef.current) {
      return;
    }

    playbackSaveTimerRef.current = window.setTimeout(() => {
      playbackSaveTimerRef.current = null;
      void persistPlayback();
    }, 4000);
  }

  async function persistPlayback(forceComplete = false) {
    if (!activeShow || !selectedEpisode || !videoRef.current) {
      return;
    }

    const progressSeconds = forceComplete ? 0 : Math.floor(videoRef.current.currentTime || 0);
    const duration = Math.floor(videoRef.current.duration || selectedEpisode.durationSeconds || 0);

    const nextEntry: HistoryEntry = {
      showId: activeShow.showId,
      showTitle: activeShow.title,
      searchTitle: activeShow.searchTitle || activeShow.title,
      episodeLink: selectedEpisode.link,
      epNum: selectedEpisode.epNum,
      progressSeconds,
      durationSeconds: duration,
      watchedAt: Date.now(),
      imgUrl: activeShow.imgUrl,
      anilistId: activeShow.anilistId ?? null,
      sourceId: activeShow.sourceId ?? null,
    };

    const nextHistory = await runtime.recordPlayback(nextEntry);
    syncHistoryState(nextHistory);
  }

  async function playEpisode(episode: EpisodeEntry) {
    setBusyAction(`Resolving episode ${episode.epNum}`);
    setStatusLabel(`Resolving episode ${episode.epNum}`);
    setErrorMessage("");

    try {
      const streamUrl = await runtime.getStream(episode.link);
      const video = videoRef.current;
      if (!video) {
        throw new Error("Video element is unavailable.");
      }

      const resumeAt = Math.max(0, Math.floor(episode.resumeSeconds ?? 0));
      const canUseHls = isHlsStream(streamUrl) && Hls.isSupported();

      resetPlaybackSession();
      setSelectedEpisode(episode);
      setCurrentStreamUrl(streamUrl);
      setPlaybackSeconds(resumeAt);
      setDurationSeconds(episode.durationSeconds ?? 0);

      const applyResumePoint = () => {
        if (resumeAt > 0 && Math.abs(video.currentTime - resumeAt) > 1) {
          video.currentTime = resumeAt;
        }
        video.removeEventListener("loadedmetadata", applyResumePoint);
      };
      video.addEventListener("loadedmetadata", applyResumePoint);

      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      if (canUseHls) {
        const hls = new Hls();
        hlsRef.current = hls;
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
          const level = hls.levels[data.level];
          setQualityLabel(formatQualityLabel(level?.height || video.videoHeight));
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          const currentLevel = hls.currentLevel >= 0 ? hls.currentLevel : hls.firstLevel;
          const level = currentLevel >= 0 ? hls.levels[currentLevel] : hls.levels[0];
          setQualityLabel(formatQualityLabel(level?.height || video.videoHeight));
          void video.play();
        });
      } else {
        video.src = streamUrl;
        setQualityLabel(formatQualityLabel(video.videoHeight || 0));
        await video.play();
      }

      setBusyAction("");
      setStatusLabel(`Playing episode ${episode.epNum}`);
    } catch (error) {
      setBusyAction("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to play this episode.");
      setStatusLabel("Playback failed");
    }
  }

  async function toggleFavorite(show: ShowSummary) {
    const nextFavorites = await runtime.setFavorite(show, !favoriteIds.has(show.showId));
    setFavorites(nextFavorites);
  }

  async function handleUpdateCheck() {
    setBusyAction("Checking for updates");
    try {
      const result = await runtime.checkForUpdates();
      setUpdateResult(result);
      setBusyAction("");
    } catch (error) {
      setBusyAction("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to check for updates.");
    }
  }

  const heroShow = featured?.hero;
  const showImage = activeShow?.bannerImage || activeShow?.imgUrl || "";

  return (
    <>
      <style id="turtle-runtime-theme">{themeCss}</style>
      <div
        className={`${themeClass} turtle-scene${settings?.reduceMotion ? " turtle-scene--calm" : ""}${windowState.isDesktop ? " turtle-scene--desktop" : ""}`}
        style={sceneStyle}
      >
        <div className="scene-orb scene-orb--left" aria-hidden="true" />
        <div className="scene-orb scene-orb--right" aria-hidden="true" />
        <div className="scene-dots" aria-hidden="true" />

        <div className={`turtle-shell${settings?.compactDensity ? " turtle-shell--compact" : ""}`}>
          <header className="turtle-titlebar">
            <div className="turtle-titlebar__controls">
              {windowState.isDesktop && (
                <>
                  <button
                    aria-label="Minimize window"
                    className="window-control-button"
                    onClick={() => {
                      const pending = window.api?.window?.minimize?.();
                      void pending?.then((state) => state && setWindowState(state));
                    }}
                    type="button"
                  >
                    <Minus />
                  </button>
                  <button
                    aria-label={windowState.isMaximized ? "Restore window" : "Maximize window"}
                    className="window-control-button"
                    onClick={() => {
                      const pending = window.api?.window?.toggleMaximize?.();
                      void pending?.then((state) => state && setWindowState(state));
                    }}
                    type="button"
                  >
                    {windowState.isMaximized ? <Maximize2 /> : <Square />}
                  </button>
                  <button
                    aria-label="Close window"
                    className="window-control-button window-control-button--danger"
                    onClick={() => void window.api?.window?.close?.()}
                    type="button"
                  >
                    <X />
                  </button>
                </>
              )}
            </div>

            <div className="turtle-titlebar__meta">
              <strong>Turtle</strong>
              <span>{runtimeMode === "standalone" ? "Standalone Client" : "Gamelette Runtime"}</span>
            </div>
          </header>

        <aside className="turtle-sidebar">
          <div className="turtle-brand">
            <div className="turtle-brand__icon">🐢</div>
            <div>
              <h1>Turtle</h1>
              <p>Watch Party Engine</p>
            </div>
          </div>

          <div className={`status-pill${errorMessage ? " status-pill--error" : ""}`}>
            {busyAction ? <LoaderCircle className="spin" /> : <Sparkles />}
            <span>{busyAction || statusLabel}</span>
          </div>

          <nav className="turtle-nav">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = page === item.id;
              return (
                <button
                  className={`nav-link${active ? " nav-link--active" : ""}`}
                  key={item.id}
                  onClick={() => navigateTo(item.id)}
                  type="button"
                >
                  <span className="nav-link__icon"><Icon /></span>
                  <span className="nav-link__copy">
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="turtle-workspace">
          <header className="workspace-header">
            <div className="workspace-copy">
              <p className="workspace-copy__eyebrow">
                {page === "show" ? "Show" : page === "my-list" ? "Saved Library" : page === "history" ? "Recently Watched" : page === "settings" ? "Preferences" : "Discover"}
              </p>
              <h2>
                {page === "show" ? activeShow?.title ?? "Show" : page === "my-list" ? "My List" : page === "history" ? "History" : page === "settings" ? "Settings" : "Featured"}
              </h2>
              <p>
                {page === "show"
                  ? activeShow?.description || "Select an episode and Turtle will resolve the final stream through the existing scraper bridge."
                  : page === "my-list"
                    ? "Favorited shows stay here so the next session is one click away."
                    : page === "history"
                      ? "Resume episodes from where you left them, with watch progress tracked automatically."
                      : page === "settings"
                        ? "Tune cache behavior, interface density, playback defaults, and future update scaffolding."
                        : "AniList discovery and continue-watching live here, while search stays globally available."}
              </p>
            </div>

            <form
              className="workspace-search"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSearchSubmit();
              }}
            >
              <div className="workspace-search__field">
                <Search className="workspace-search__icon" />
                <input
                  autoComplete="off"
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search anime titles"
                  value={searchQuery}
                />
                {suggestions.length > 0 && (
                  <div className="workspace-search__suggestions">
                    {suggestions.map((item) => (
                      <button
                        className="suggestion-row"
                        key={item.id}
                        onClick={() => {
                          setSearchQuery(item.searchTitle);
                          void handleSearchSubmit(item.searchTitle);
                        }}
                        type="button"
                      >
                        <strong>{item.romaji}</strong>
                        <span>{item.english || item.searchTitle}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button className="action-button action-button--primary" type="submit">
                Search
              </button>
            </form>
          </header>

          {errorMessage && (
            <section className="error-banner">
              <span>{errorMessage}</span>
              <button className="action-button" onClick={() => setErrorMessage("")} type="button">
                Dismiss
              </button>
            </section>
          )}

          {showSearchResults && (
            <section className="panel-block">
              <div className="section-header">
                <div>
                  <h3>Search Results</h3>
                  <p>{searchResults.length ? `Showing matches for “${searchQuery}”.` : "Run a search to load results here."}</p>
                </div>
                <button className="icon-button" onClick={() => setShowSearchResults(false)} type="button">
                  <ExternalLink />
                </button>
              </div>

              <div className="show-grid">
                {searchResults.map((show) => (
                  <button className="show-card" key={show.showId} onClick={() => void openShow(show)} type="button">
                    <img alt={show.title} src={runtime.resolveImageUrl(show.imgUrl)} />
                    <div className="show-card__copy">
                      <strong>{show.title}</strong>
                      <span>{show.subtitle || "Search match"}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {page === "featured" && (
            <>
              <section className="content-grid">
                <button
                  className="hero-card"
                  disabled={!heroShow}
                  onClick={() => heroShow && void openShow(heroShow)}
                  type="button"
                >
                  {heroShow && <img alt={heroShow.title} className="hero-card__image" src={runtime.resolveImageUrl(heroShow.bannerImage || heroShow.imgUrl)} />}
                  <div className="hero-card__overlay" />
                  <div className="hero-card__content">
                    <div>
                      <span className="hero-card__badge">{heroShow?.badge || "Featured"}</span>
                      <h3>{heroShow?.title || "Loading featured anime"}</h3>
                      <p>{heroShow?.subtitle || "AniList discovery"}</p>
                      <span className="hero-card__copy">{heroShow?.description || "Fresh discovery and continue-watching, wrapped in the new Turtle shell."}</span>
                    </div>
                    <span className="hero-card__play"><Play /></span>
                  </div>
                </button>

                <div className="panel-list">
                  <div className="section-header">
                    <div>
                      <h3>Continue Watching</h3>
                      <p>Resume from your most recent episode checkpoints.</p>
                    </div>
                  </div>
                  {(featured?.continueWatching ?? history.filter((entry) => entry.progressSeconds > 0)).slice(0, 6).map((entry) => (
                    <button
                      className="list-row"
                      key={`${entry.showId}:${entry.episodeLink}`}
                      onClick={() => void openPlaybackEntry(entry)}
                      type="button"
                    >
                      <img alt={entry.showTitle} src={runtime.resolveImageUrl(entry.imgUrl)} />
                      <div className="list-row__copy">
                        <strong>{entry.showTitle}</strong>
                        <span>Episode {entry.epNum} • Resume at {formatDuration(entry.progressSeconds)}</span>
                      </div>
                      <span className="list-row__meta">{formatRelativeTime(entry.watchedAt)}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="panel-block">
                <div className="section-header">
                  <div>
                    <h3>Trending Now</h3>
                    <p>Fresh AniList discovery with cached artwork in standalone mode.</p>
                  </div>
                </div>
                <div className="show-grid">
                  {(featured?.trending ?? []).map((show) => (
                    <button className="show-card" key={show.showId} onClick={() => void openShow(show)} type="button">
                      <img alt={show.title} src={runtime.resolveImageUrl(show.imgUrl)} />
                      <div className="show-card__copy">
                        <strong>{show.title}</strong>
                        <span>{show.subtitle || "Trending"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {page === "my-list" && (
            <section className="panel-block">
              <div className="section-header">
                <div>
                  <h3>Saved Shows</h3>
                  <p>{favorites.length ? "Favorites persist between launches in standalone mode and fall back locally in gamelette mode." : "Favorite any show from Featured or Search to build your list."}</p>
                </div>
              </div>
              <div className="show-grid">
                {favorites.map((show) => (
                  <button className="show-card" key={show.showId} onClick={() => void openShow(show)} type="button">
                    <img alt={show.title} src={runtime.resolveImageUrl(show.imgUrl)} />
                    <div className="show-card__copy">
                      <strong>{show.title}</strong>
                      <span>{show.subtitle || "Saved show"}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {page === "history" && (
            <section className="panel-block">
              <div className="section-header">
                <div>
                  <h3>Watch History</h3>
                  <p>Episode history keeps track of when you watched and where playback should resume.</p>
                </div>
                <button
                  className="action-button"
                  onClick={() => void runtime.clearHistory().then((next) => syncHistoryState(next))}
                  type="button"
                >
                  <Trash2 />
                  Clear
                </button>
              </div>
              <div className="panel-list">
                {history.map((entry) => (
                  <button
                    className="list-row"
                    key={`${entry.showId}:${entry.episodeLink}`}
                    onClick={() => void openPlaybackEntry(entry)}
                    type="button"
                  >
                    <img alt={entry.showTitle} src={runtime.resolveImageUrl(entry.imgUrl)} />
                    <div className="list-row__copy">
                      <strong>{entry.showTitle}</strong>
                      <span>Episode {entry.epNum} • {formatDuration(entry.progressSeconds)} / {formatDuration(entry.durationSeconds)}</span>
                    </div>
                    <span className="list-row__meta">{formatRelativeTime(entry.watchedAt)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {page === "settings" && settings && cacheStats && (
            <>
              <section className="settings-grid">
                <article className="settings-card">
                  <div className="settings-card__header">
                    <span className="settings-card__icon"><SlidersHorizontal /></span>
                    <h3>Interface scale</h3>
                  </div>
                  <p>Scale the Celadon-style shell up or down without changing the core layout.</p>
                  <input
                    className="range"
                    max="1.3"
                    min="0.85"
                    onChange={(event) =>
                      void runtime.updateSettings({ uiScale: Number(event.target.value) }).then((next) => setSettings(next))
                    }
                    step="0.05"
                    type="range"
                    value={settings.uiScale}
                  />
                  <strong>{Math.round(settings.uiScale * 100)}%</strong>
                </article>

                <article className="settings-card">
                  <div className="settings-card__header">
                    <span className="settings-card__icon"><Bookmark /></span>
                    <h3>Artwork cache</h3>
                  </div>
                  <p>Cache posters and thumbnails on disk in standalone mode to reduce bandwidth and speed up reloads.</p>
                  <input
                    className="range"
                    max="512"
                    min="64"
                    onChange={(event) =>
                      void runtime.setCacheLimit(Number(event.target.value)).then((stats) => {
                        setCacheStats(stats);
                        setSettings((current) => current ? { ...current, cacheLimitMb: Number(event.target.value) } : current);
                      })
                    }
                    step="32"
                    type="range"
                    value={settings.cacheLimitMb}
                  />
                  <strong>{settings.cacheLimitMb} MB</strong>
                  <small>{formatMegabytes(cacheStats.totalBytes)} used across {cacheStats.entryCount} items.</small>
                  <button
                    className="action-button"
                    onClick={() => void runtime.clearCache().then((stats) => setCacheStats(stats))}
                    type="button"
                  >
                    <Trash2 />
                    Clear cache
                  </button>
                </article>

                <article className="settings-card">
                  <div className="settings-card__header">
                    <span className="settings-card__icon"><Palette /></span>
                    <h3>Theme</h3>
                  </div>
                  <p>Use Proteus-compatible theme files from <code>resources/themes</code> and switch between dark and light token sets.</p>
                  <div className="segmented-control">
                    <button
                      className={`segmented-control__button${settings.themeMode === "dark" ? " segmented-control__button--active" : ""}`}
                      onClick={() =>
                        void runtime.updateSettings({ themeMode: "dark" }).then((next) => setSettings(next))
                      }
                      type="button"
                    >
                      <Moon />
                      Dark
                    </button>
                    <button
                      className={`segmented-control__button${settings.themeMode === "light" ? " segmented-control__button--active" : ""}`}
                      onClick={() =>
                        void runtime.updateSettings({ themeMode: "light" }).then((next) => setSettings(next))
                      }
                      type="button"
                    >
                      <Sun />
                      Light
                    </button>
                  </div>
                  <label className="field-label" htmlFor="theme-select">Theme preset</label>
                  <select
                    className="select-field"
                    disabled={availableThemes.length === 0}
                    id="theme-select"
                    onChange={(event) =>
                      void runtime.updateSettings({ themeFile: event.target.value }).then((next) => setSettings(next))
                    }
                    value={settings.themeFile}
                  >
                    {availableThemes.length === 0
                      ? <option value={settings.themeFile}>{formatThemeName(settings.themeFile)}</option>
                      : availableThemes.map((theme) => (
                        <option key={theme} value={theme}>{formatThemeName(theme)}</option>
                      ))}
                  </select>
                  <small>
                    {availableThemes.length > 0
                      ? "Theme files are loaded from resources/themes using the Proteus theme contract."
                      : "Theme library selection is available in standalone mode; the built-in Proteus default still supports dark and light."}
                  </small>
                  {window.bergamot?.openThemesFolder && availableThemes.length > 0 && (
                    <button
                      className="action-button"
                      onClick={() => void window.bergamot?.openThemesFolder?.()}
                      type="button"
                    >
                      <ExternalLink />
                      Open themes folder
                    </button>
                  )}
                </article>

                <article className="settings-card">
                  <div className="settings-card__header">
                    <span className="settings-card__icon"><Play /></span>
                    <h3>Playback behavior</h3>
                  </div>
                  <p>Keep autoplay and motion settings aligned with how you want Turtle to feel between episodes.</p>
                  <label className="toggle-row">
                    <span>Autoplay next episode</span>
                    <input
                      checked={settings.autoplayNext}
                      onChange={(event) =>
                        void runtime.updateSettings({ autoplayNext: event.target.checked }).then((next) => setSettings(next))
                      }
                      type="checkbox"
                    />
                  </label>
                  <label className="toggle-row">
                    <span>Reduce motion</span>
                    <input
                      checked={settings.reduceMotion}
                      onChange={(event) =>
                        void runtime.updateSettings({ reduceMotion: event.target.checked }).then((next) => setSettings(next))
                      }
                      type="checkbox"
                    />
                  </label>
                  <label className="toggle-row">
                    <span>Compact density</span>
                    <input
                      checked={settings.compactDensity}
                      onChange={(event) =>
                        void runtime.updateSettings({ compactDensity: event.target.checked }).then((next) => setSettings(next))
                      }
                      type="checkbox"
                    />
                  </label>
                </article>

                <article className="settings-card">
                  <div className="settings-card__header">
                    <span className="settings-card__icon"><RotateCw /></span>
                    <h3>Updates</h3>
                  </div>
                  <p>Wire up repository polling later without changing the UI surface again.</p>
                  <button className="action-button action-button--primary" onClick={() => void handleUpdateCheck()} type="button">
                    <RotateCw />
                    Check now
                  </button>
                  <small>{updateResult?.message || "TODO: repository target not configured yet."}</small>
                </article>
              </section>
            </>
          )}

          <section className={`show-workspace${page === "show" ? "" : " show-workspace--hidden"}`}>
            <div className="viewer-grid">
              <section className="viewer-stage">
                <div
                  className={`viewer-stage__media${isPlayerFullscreen ? " viewer-stage__media--fullscreen" : ""}`}
                  onClick={() => {
                    if (isPlayerFullscreen) {
                      revealFullscreenControls();
                    }
                  }}
                  onMouseMove={() => revealFullscreenControls()}
                  ref={viewerSurfaceRef}
                >
                  <video
                    controls={false}
                    muted={false}
                    playsInline
                    ref={videoRef}
                    src={Hls.isSupported() ? undefined : currentStreamUrl || undefined}
                  />
                  <div className="viewer-stage__hud">
                    <span className="quality-badge">{qualityLabel}</span>
                  </div>
                  {!selectedEpisode && (
                    <div className="viewer-stage__placeholder">
                      {showImage && <img alt={activeShow?.title || "Poster"} src={runtime.resolveImageUrl(showImage)} />}
                      <div>
                        <h3>{activeShow?.title || "Select a show"}</h3>
                        <p>Pick an episode to resolve the final stream through Turtle’s existing scraper pipeline.</p>
                      </div>
                    </div>
                  )}
                  {selectedEpisode && (
                    <div className={`floating-player-controls${showFullscreenControls ? " floating-player-controls--visible" : ""}${isPlayerFullscreen ? " floating-player-controls--fullscreen" : ""}`}>
                      <div className="floating-player-controls__track">
                        <div className="floating-player-controls__cover">
                          {activeShow ? <img alt={activeShow.title} src={runtime.resolveImageUrl(activeShow.imgUrl)} /> : <Home />}
                        </div>
                        <div className="floating-player-controls__copy">
                          <strong>{activeShow?.title || "Turtle"}</strong>
                          <span>{selectedEpisode ? `Episode ${selectedEpisode.epNum}` : "No episode selected"}</span>
                        </div>
                      </div>
                      <div className="floating-player-controls__center">
                        <div className="transport">
                          <button className="transport__button" disabled={!selectedEpisode} onClick={() => playPreviousEpisode()} type="button">
                            <SkipBack />
                          </button>
                          <button className="transport__button transport__button--primary" disabled={!selectedEpisode} onClick={() => togglePlayback()} type="button">
                            {isPlaying ? <Pause /> : <Play />}
                          </button>
                          <button className="transport__button" disabled={!selectedEpisode} onClick={() => playNextEpisode()} type="button">
                            <SkipForward />
                          </button>
                        </div>
                        <div className="progress-row">
                          <span>{formatDuration(playbackSeconds)}</span>
                          <div className="progress-slider">
                            <input
                              max={Math.max(durationSeconds, 1)}
                              min={0}
                              onChange={(event) => handleSeek(Number(event.target.value))}
                              type="range"
                              value={Math.min(playbackSeconds, Math.max(durationSeconds, 1))}
                            />
                            <span className="progress-slider__glow" style={{ width: `${progressPercent}%` }} />
                          </div>
                          <span>{formatDuration(durationSeconds)}</span>
                        </div>
                      </div>
                      <div className="floating-player-controls__volume">
                        <span className="quality-badge quality-badge--ghost">{qualityLabel}</span>
                        <Volume2 />
                        <input
                          max={1}
                          min={0}
                          onChange={(event) => handleVolumeChange(Number(event.target.value))}
                          step={0.01}
                          type="range"
                          value={volumeLevel}
                        />
                        <button className="transport__button" onClick={() => void togglePlayerFullscreen()} type="button">
                          {isPlayerFullscreen ? <Minimize2 /> : <Maximize2 />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {activeShow && (
                  <div className="viewer-stage__meta">
                    <div>
                      <span className="viewer-stage__badge">{activeShow.badge || "Watch Party Engine"}</span>
                      <h3>{selectedEpisode ? `Now Playing Episode ${selectedEpisode.epNum}` : "Ready to Watch"}</h3>
                      <p>
                        {selectedEpisode
                          ? `${activeShow.title}${activeShow.subtitle ? ` • ${activeShow.subtitle}` : ""}`
                          : activeShow.subtitle || "Pick an episode to start playback in the main viewer."}
                      </p>
                    </div>
                    <button className="action-button" onClick={() => void toggleFavorite(activeShow)} type="button">
                      <Heart className={favoriteIds.has(activeShow.showId) ? "filled-heart" : ""} />
                      {favoriteIds.has(activeShow.showId) ? "Saved" : "Save show"}
                    </button>
                  </div>
                )}
              </section>

              <aside className="episode-panel">
                <div className="section-header">
                  <div>
                    <h3>Episodes</h3>
                    <p>{episodes.length ? `${episodes.length} episodes loaded for ${activeShow?.title ?? "this show"}.` : "Episodes will appear here once the show resolves."}</p>
                  </div>
                  {activeShow && <Star className="episode-panel__icon" />}
                </div>

                <div className="panel-list panel-list--episodes">
                  {episodes.map((episode) => (
                    <button
                      className={`episode-row${selectedEpisode?.link === episode.link ? " episode-row--active" : ""}`}
                      key={episode.link}
                      onClick={() => void playEpisode(episode)}
                      type="button"
                    >
                      <div>
                        <strong>Episode {episode.epNum}</strong>
                        <span>{episode.resumeSeconds ? `Resume at ${formatDuration(episode.resumeSeconds)}` : "Start from the beginning"}</span>
                      </div>
                      <Play />
                    </button>
                  ))}
                </div>
              </aside>
            </div>
          </section>
        </main>

        <footer className="player-dock">
          <div className="player-dock__track">
            <div className="player-dock__cover">
              {activeShow ? <img alt={activeShow.title} src={runtime.resolveImageUrl(activeShow.imgUrl)} /> : <Home />}
            </div>
            <div className="player-dock__copy">
              <strong>{activeShow?.title || "Pick a show"}</strong>
              <span>
                {selectedEpisode
                  ? `Episode ${selectedEpisode.epNum}`
                  : "Search, discover, and start a watch session"}
              </span>
            </div>
          </div>

          <div className="player-dock__center">
            <div className="transport">
              <button
                className="transport__button"
                disabled={!selectedEpisode}
                onClick={() => playPreviousEpisode()}
                type="button"
              >
                <SkipBack />
              </button>
              <button
                className="transport__button transport__button--primary"
                disabled={!selectedEpisode}
                onClick={() => togglePlayback()}
                type="button"
              >
                {isPlaying ? <Pause /> : <Play />}
              </button>
              <button
                className="transport__button"
                disabled={!selectedEpisode}
                onClick={() => playNextEpisode()}
                type="button"
              >
                <SkipForward />
              </button>
            </div>

            <div className="progress-row">
              <span>{formatDuration(playbackSeconds)}</span>
              <div className="progress-slider">
                <input
                  max={Math.max(durationSeconds, 1)}
                  min={0}
                  onChange={(event) => handleSeek(Number(event.target.value))}
                  type="range"
                  value={Math.min(playbackSeconds, Math.max(durationSeconds, 1))}
                />
                <span className="progress-slider__glow" style={{ width: `${progressPercent}%` }} />
              </div>
              <span>{formatDuration(durationSeconds)}</span>
            </div>
          </div>

          <div className="player-dock__volume">
            <span className="quality-badge quality-badge--ghost">{qualityLabel}</span>
            <Volume2 />
            <input
              max={1}
              min={0}
              onChange={(event) => handleVolumeChange(Number(event.target.value))}
              step={0.01}
              type="range"
              value={volumeLevel}
            />
            <button className="transport__button" disabled={!selectedEpisode} onClick={() => void togglePlayerFullscreen()} type="button">
              {isPlayerFullscreen ? <Minimize2 /> : <Maximize2 />}
            </button>
          </div>
        </footer>
      </div>
      </div>
    </>
  );
}
