import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";

import { getTurtleCacheDir, getTurtleCacheIndexPath } from "./paths.js";
import { type CacheIndexEntry, type CacheIndexState, type CacheStats } from "./types.js";

const DEFAULT_INDEX: CacheIndexState = {
  entries: {},
};

function hashSource(src: string): string {
  return createHash("sha1").update(src).digest("hex");
}

function getExtensionFromContentType(contentType: string, src: string): string {
  if (contentType.includes("image/jpeg")) return ".jpg";
  if (contentType.includes("image/png")) return ".png";
  if (contentType.includes("image/webp")) return ".webp";
  if (contentType.includes("image/gif")) return ".gif";
  if (contentType.includes("image/avif")) return ".avif";
  const extension = extname(new URL(src).pathname).toLowerCase();
  return extension || ".img";
}

function getCacheFilePath(entry: CacheIndexEntry): string {
  return join(getTurtleCacheDir(), entry.fileName);
}

async function loadIndex(): Promise<CacheIndexState> {
  try {
    const raw = await readFile(getTurtleCacheIndexPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<CacheIndexState>;
    return {
      entries: parsed.entries ?? {},
    };
  } catch {
    return {
      ...DEFAULT_INDEX,
      entries: {},
    };
  }
}

async function saveIndex(index: CacheIndexState): Promise<void> {
  const indexPath = getTurtleCacheIndexPath();
  await mkdir(dirname(indexPath), { recursive: true });
  const tempPath = `${indexPath}.tmp`;
  await writeFile(tempPath, JSON.stringify(index, null, 2), "utf8");
  await rename(tempPath, indexPath);
}

export class TurtleImageCache {
  async getStats(limitBytes: number): Promise<CacheStats> {
    const index = await loadIndex();
    const totalBytes = Object.values(index.entries).reduce((sum, entry) => sum + entry.size, 0);
    return {
      entryCount: Object.keys(index.entries).length,
      totalBytes,
      limitBytes,
      utilization: limitBytes > 0 ? Math.min(1, totalBytes / limitBytes) : 0,
    };
  }

  async clear(): Promise<void> {
    const cacheDir = getTurtleCacheDir();
    await rm(cacheDir, { recursive: true, force: true });
    await mkdir(cacheDir, { recursive: true });
    await saveIndex({ entries: {} });
  }

  async ensure(src: string, limitBytes: number): Promise<CacheIndexEntry> {
    const index = await loadIndex();
    const existing = index.entries[src];

    if (existing && existsSync(getCacheFilePath(existing))) {
      existing.lastAccessedAt = Date.now();
      index.entries[src] = existing;
      await saveIndex(index);
      return existing;
    }

    const response = await fetch(src, {
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.2",
      },
    });

    if (!response.ok) {
      throw new Error(`Unable to cache image ${src}: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    if (!contentType.startsWith("image/")) {
      throw new Error(`Unsupported image response for ${src}: ${contentType}`);
    }

    const hash = hashSource(src);
    const extension = getExtensionFromContentType(contentType, src);
    const fileName = `${hash}${extension}`;
    const cacheFilePath = join(getTurtleCacheDir(), fileName);
    const tempFilePath = `${cacheFilePath}.tmp`;

    const body = Buffer.from(await response.arrayBuffer());
    await mkdir(dirname(tempFilePath), { recursive: true });
    await writeFile(tempFilePath, body);
    const fileStats = await stat(tempFilePath);
    await rename(tempFilePath, cacheFilePath);

    const entry: CacheIndexEntry = {
      src,
      contentType,
      extension,
      fileName,
      size: fileStats.size,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    index.entries[src] = entry;
    await this.evictIfNeeded(index, limitBytes);
    await saveIndex(index);
    return entry;
  }

  async read(entry: CacheIndexEntry): Promise<Buffer> {
    return readFile(getCacheFilePath(entry));
  }

  createStream(entry: CacheIndexEntry) {
    return createReadStream(getCacheFilePath(entry));
  }

  private async evictIfNeeded(index: CacheIndexState, limitBytes: number): Promise<void> {
    let totalBytes = Object.values(index.entries).reduce((sum, entry) => sum + entry.size, 0);
    if (totalBytes <= limitBytes) {
      return;
    }

    const sorted = Object.values(index.entries).sort(
      (left, right) => left.lastAccessedAt - right.lastAccessedAt,
    );

    for (const entry of sorted) {
      if (totalBytes <= limitBytes) {
        break;
      }

      delete index.entries[entry.src];
      totalBytes -= entry.size;
      await unlink(getCacheFilePath(entry)).catch(() => {});
    }
  }
}
