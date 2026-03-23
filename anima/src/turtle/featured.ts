import { type HistoryEntry, type FeaturedPayload, type ShowSummary } from "./types.js";

interface AniListPageMedia {
  id: number;
  title?: {
    romaji?: string | null;
    english?: string | null;
  };
  description?: string | null;
  bannerImage?: string | null;
  coverImage?: {
    large?: string | null;
    extraLarge?: string | null;
  };
  format?: string | null;
  season?: string | null;
  seasonYear?: number | null;
  averageScore?: number | null;
}

interface AniListFeaturedResponse {
  data?: {
    trending?: {
      media?: AniListPageMedia[];
    };
    seasonal?: {
      media?: AniListPageMedia[];
    };
  };
}

function getCurrentSeason(): { season: "WINTER" | "SPRING" | "SUMMER" | "FALL"; year: number } {
  const now = new Date();
  const month = now.getUTCMonth();
  if (month <= 1 || month === 11) {
    return { season: "WINTER", year: month === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear() };
  }
  if (month <= 4) {
    return { season: "SPRING", year: now.getUTCFullYear() };
  }
  if (month <= 7) {
    return { season: "SUMMER", year: now.getUTCFullYear() };
  }
  return { season: "FALL", year: now.getUTCFullYear() };
}

function stripHtml(value: string | null | undefined): string | null {
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

function toShowSummary(item: AniListPageMedia, badge: string): ShowSummary | null {
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
    subtitle: subtitleParts.join(" • ") || null,
    description: stripHtml(item.description),
    imgUrl,
    anilistId: item.id,
    badge,
    bannerImage: item.bannerImage || null,
    searchTitle,
  };
}

export async function fetchFeaturedShows(history: HistoryEntry[]): Promise<FeaturedPayload> {
  const { season, year } = getCurrentSeason();

  const query = `
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
          averageScore
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
          averageScore
        }
      }
    }
  `;

  let trending: ShowSummary[] = [];
  let seasonal: ShowSummary[] = [];

  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          season,
          seasonYear: year,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`AniList featured request failed with status ${response.status}`);
    }

    const json = (await response.json()) as AniListFeaturedResponse;
    trending = (json.data?.trending?.media ?? [])
      .map((item) => toShowSummary(item, "Trending"))
      .filter((item): item is ShowSummary => Boolean(item));
    seasonal = (json.data?.seasonal?.media ?? [])
      .map((item) => toShowSummary(item, "Seasonal"))
      .filter((item): item is ShowSummary => Boolean(item));
  } catch (error) {
    console.error("AniList featured discovery error:", error);
  }

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
