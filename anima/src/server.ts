import { exec } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { basename, resolve } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

import {
  extractStreamSource,
  getEpisodes,
  getSuggestions,
  search,
} from "./scraper.js";
import { TurtleService } from "./turtle/service.js";
import { type HistoryEntry, type ShowSummary, type TurtleSettings } from "./turtle/types.js";

export interface StandaloneServerSession {
  apiKey: string;
  clientUrl: string;
  port: number;
  stop(): Promise<void>;
}

interface StartStandaloneServerOptions {
  openClient?: boolean;
}

const HOSTNAME = "127.0.0.1";
const STREAM_PROXY_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const turtleService = new TurtleService();

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Range",
  "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, Content-Type",
};

function getRequiredParam(url: URL, key: string): string | null {
  const value = url.searchParams.get(key)?.trim() ?? "";
  return value ? value : null;
}

function resolveTurtleIndexPath(): string {
  const bundledBuildPath = resolve(__dirname, "games", "Turtle", "dist", "standalone", "index.html");
  if (existsSync(bundledBuildPath)) {
    return bundledBuildPath;
  }

  const bundledFallbackPath = resolve(__dirname, "games", "Turtle", "index.html");
  if (existsSync(bundledFallbackPath)) {
    return bundledFallbackPath;
  }

  const workspaceBuildPath = resolve(__dirname, "..", "..", "games", "Turtle", "dist", "standalone", "index.html");
  if (existsSync(workspaceBuildPath)) {
    return workspaceBuildPath;
  }

  return resolve(__dirname, "..", "..", "games", "Turtle", "index.html");
}

function resolveThemeDirectory(): string {
  const bundledThemePath = resolve(__dirname, "resources", "themes");
  if (existsSync(bundledThemePath)) {
    return bundledThemePath;
  }

  return resolve(__dirname, "..", "..", "resources", "themes");
}

function writeJson(
  response: ServerResponse<IncomingMessage>,
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): void {
  const body = JSON.stringify(data);

  response.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Length": Buffer.byteLength(body).toString(),
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(body);
}

function writeText(
  response: ServerResponse<IncomingMessage>,
  body: string,
  contentType: string,
  status = 200,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Length": Buffer.byteLength(body).toString(),
    "Content-Type": contentType,
    ...headers,
  });
  response.end(body);
}

function writeError(
  response: ServerResponse<IncomingMessage>,
  message: string,
  status = 400,
  headers: Record<string, string> = {},
): void {
  writeJson(response, { message }, status, headers);
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function getApiBaseUrl(port: number): string {
  return `http://${HOSTNAME}:${port}/api`;
}

function getStandaloneLaunchUrl(indexPath: string, port: number, apiKey: string): URL {
  const launchUrl = pathToFileURL(indexPath);
  launchUrl.searchParams.set("api_port", String(port));
  launchUrl.searchParams.set("api_key", apiKey);
  return launchUrl;
}

function buildMediaProxyUrl(
  apiBaseUrl: string,
  apiKey: string,
  sourceUrl: string,
  referer: string,
): string {
  const suffixMatch = sourceUrl.match(/\.(m3u8|mp4)(?:\?|$)/i);
  const suffix = suffixMatch ? `.${suffixMatch[1].toLowerCase()}` : "";
  const proxyUrl = new URL(`${apiBaseUrl}/media${suffix}`);
  proxyUrl.searchParams.set("token", apiKey);
  proxyUrl.searchParams.set("url", sourceUrl);
  proxyUrl.searchParams.set("referer", referer);
  return proxyUrl.toString();
}

function resolveRemoteUrl(input: string, baseUrl: string): string {
  try {
    return new URL(input, baseUrl).toString();
  } catch {
    return input;
  }
}

function getOriginHeader(referer: string): string | null {
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function isPlaylistResponse(url: string, contentType: string): boolean {
  return (
    /\.m3u8(?:\?|$)/i.test(url) ||
    contentType.includes("application/vnd.apple.mpegurl") ||
    contentType.includes("application/x-mpegurl") ||
    contentType.includes("audio/mpegurl")
  );
}

function rewritePlaylistTagUris(
  line: string,
  currentUrl: string,
  apiBaseUrl: string,
  apiKey: string,
  referer: string,
): string {
  return line.replace(/URI="([^"]+)"/g, (_match, value) => {
    const absoluteUrl = resolveRemoteUrl(value, currentUrl);
    return `URI="${buildMediaProxyUrl(apiBaseUrl, apiKey, absoluteUrl, referer)}"`;
  });
}

function rewritePlaylistBody(
  body: string,
  currentUrl: string,
  apiBaseUrl: string,
  apiKey: string,
  referer: string,
): string {
  return body
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) {
        return line;
      }

      if (line.startsWith("#")) {
        return rewritePlaylistTagUris(line, currentUrl, apiBaseUrl, apiKey, referer);
      }

      return buildMediaProxyUrl(
        apiBaseUrl,
        apiKey,
        resolveRemoteUrl(line.trim(), currentUrl),
        referer,
      );
    })
    .join("\n");
}

function buildProxyRequestHeaders(request: IncomingMessage, referer: string): Headers {
  const headers = new Headers({
    Accept: request.headers.accept || "*/*",
    "User-Agent": STREAM_PROXY_USER_AGENT,
  });

  if (referer) {
    headers.set("Referer", referer);
    const origin = getOriginHeader(referer);
    if (origin) {
      headers.set("Origin", origin);
    }
  }

  if (typeof request.headers.range === "string" && request.headers.range.length > 0) {
    headers.set("Range", request.headers.range);
  }

  return headers;
}

async function proxyMediaRequest(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  sourceUrl: string,
  referer: string,
  apiBaseUrl: string,
  apiKey: string,
): Promise<void> {
  const upstream = await fetch(sourceUrl, {
    headers: buildProxyRequestHeaders(request, referer),
    redirect: "follow",
  });

  if (!upstream.ok) {
    writeError(
      response,
      `Upstream media request failed with ${upstream.status} ${upstream.statusText}`,
      upstream.status,
    );
    return;
  }

  const finalUrl = upstream.url || sourceUrl;
  const contentType = upstream.headers.get("content-type")?.toLowerCase() ?? "application/octet-stream";

  if (isPlaylistResponse(finalUrl, contentType)) {
    const playlistBody = rewritePlaylistBody(
      await upstream.text(),
      finalUrl,
      apiBaseUrl,
      apiKey,
      referer,
    );
    const bodyBuffer = Buffer.from(playlistBody, "utf8");

    response.writeHead(upstream.status, {
      ...CORS_HEADERS,
      "Cache-Control": "no-store",
      "Content-Length": String(bodyBuffer.byteLength),
      "Content-Type": contentType === "application/octet-stream"
        ? "application/vnd.apple.mpegurl"
        : contentType,
    });
    response.end(bodyBuffer);
    return;
  }

  const responseHeaders: Record<string, string> = {
    ...CORS_HEADERS,
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  };

  for (const key of [
    "accept-ranges",
    "content-disposition",
    "content-length",
    "content-range",
    "etag",
    "last-modified",
  ]) {
    const value = upstream.headers.get(key);
    if (value) {
      responseHeaders[key] = value;
    }
  }

  response.writeHead(upstream.status, responseHeaders);

  if (!upstream.body) {
    response.end();
    return;
  }

  Readable.fromWeb(upstream.body as any).pipe(response);
}

function getOpenCommand(url: string): string {
  const quotedUrl = JSON.stringify(url);

  if (process.platform === "darwin") {
    return `open ${quotedUrl}`;
  }

  if (process.platform === "win32") {
    return `start "" ${quotedUrl}`;
  }

  return `xdg-open ${quotedUrl}`;
}

function launchStandaloneClient(clientUrl: string): void {
  if (process.env.TURTLE_NO_OPEN === "1") {
    console.log("Turtle browser auto-open skipped because TURTLE_NO_OPEN=1.");
    return;
  }

  exec(getOpenCommand(clientUrl), (launchError) => {
    if (launchError) {
      console.error(`Unable to open Turtle automatically: ${launchError.message}`);
    }
  });
}

function startHttpServer(apiKey: string): Promise<{
  port: number;
  stop(): Promise<void>;
}> {
  return new Promise((resolveServer, reject) => {
    const server = createServer(async (request, response) => {
      if (!request.url) {
        writeError(response, "Missing request URL", 400);
        return;
      }

      if (request.method === "OPTIONS") {
        response.writeHead(204, CORS_HEADERS);
        response.end();
        return;
      }

      const method = request.method ?? "GET";

      if (!["GET", "POST", "DELETE"].includes(method)) {
        writeError(response, "Method not allowed", 405);
        return;
      }

      const url = new URL(request.url, `http://${HOSTNAME}`);

      try {
        if (url.pathname === "/themes/manifest.json" || url.pathname.startsWith("/themes/")) {
          if (request.headers.authorization !== apiKey) {
            writeError(response, "Unauthorized", 401, {
              "WWW-Authenticate": "Bearer",
            });
            return;
          }

          const themeDir = resolveThemeDirectory();
          if (url.pathname === "/themes/manifest.json") {
            const manifestRaw = await readFile(resolve(themeDir, "manifest.json"), "utf8");
            writeText(response, manifestRaw, "application/json; charset=utf-8");
            return;
          }

          const requestedTheme = basename(url.pathname.replace(/^\/themes\//, ""));
          if (!requestedTheme) {
            writeError(response, "Theme filename is required.", 400);
            return;
          }

          const themeCss = await readFile(resolve(themeDir, requestedTheme), "utf8");
          writeText(response, themeCss, "text/css; charset=utf-8");
          return;
        }

        if (
          url.pathname.startsWith("/api/")
          && url.pathname !== "/api/image"
          && !url.pathname.startsWith("/api/media")
          && request.headers.authorization !== apiKey
        ) {
          writeError(response, "Unauthorized", 401, {
            "WWW-Authenticate": "Bearer",
          });
          return;
        }

        if (url.pathname === "/api/image") {
          const src = getRequiredParam(url, "src");
          const token = getRequiredParam(url, "token");
          if (!src || token !== apiKey) {
            writeError(response, "Unauthorized", 401);
            return;
          }

          const entry = await turtleService.ensureImage(src);
          response.writeHead(200, {
            ...CORS_HEADERS,
            "Cache-Control": "private, max-age=604800, immutable",
            "Content-Type": entry.contentType,
          });
          turtleService.createImageStream(entry).pipe(response);
          return;
        }

        if (url.pathname.startsWith("/api/media")) {
          const sourceUrl = getRequiredParam(url, "url");
          const referer = getRequiredParam(url, "referer");
          const token = getRequiredParam(url, "token");
          if (!sourceUrl || !referer || token !== apiKey) {
            writeError(response, "Unauthorized", 401);
            return;
          }

          const address = server.address();
          const apiBaseUrl = getApiBaseUrl(
            address && typeof address !== "string" ? address.port : 0,
          );
          await proxyMediaRequest(request, response, sourceUrl, referer, apiBaseUrl, apiKey);
          return;
        }

        if (url.pathname === "/api/bootstrap") {
          const address = server.address();
          const apiBaseUrl = getApiBaseUrl(
            address && typeof address !== "string" ? address.port : 0,
          );
          writeJson(
            response,
            await turtleService.getBootstrap(
              apiBaseUrl,
              `${apiBaseUrl}/image`,
              apiKey,
            ),
          );
          return;
        }

        if (url.pathname === "/api/featured") {
          writeJson(response, await turtleService.getFeatured());
          return;
        }

        if (url.pathname === "/api/favorites") {
          if (method === "GET") {
            writeJson(response, await turtleService.listFavorites());
            return;
          }

          const body = await readJsonBody<{ show?: ShowSummary; isFavorite?: boolean }>(request);
          if (!body.show || typeof body.isFavorite !== "boolean") {
            writeError(response, "Favorites updates require { show, isFavorite }.");
            return;
          }

          writeJson(response, await turtleService.setFavorite(body.show, body.isFavorite));
          return;
        }

        if (url.pathname === "/api/history") {
          if (method === "GET") {
            writeJson(response, await turtleService.listHistory());
            return;
          }

          if (method === "DELETE") {
            writeJson(response, await turtleService.clearHistory());
            return;
          }

          const body = await readJsonBody<HistoryEntry>(request);
          if (!body?.showId || !body?.episodeLink) {
            writeError(response, "History updates require a valid playback entry.");
            return;
          }

          writeJson(response, await turtleService.recordPlayback(body));
          return;
        }

        if (url.pathname === "/api/settings") {
          if (method === "GET") {
            writeJson(response, await turtleService.getSettings());
            return;
          }

          const body = await readJsonBody<Partial<TurtleSettings>>(request);
          writeJson(response, await turtleService.updateSettings(body));
          return;
        }

        if (url.pathname === "/api/cache") {
          if (method === "GET") {
            writeJson(response, await turtleService.getCacheStats());
            return;
          }

          if (method === "DELETE") {
            writeJson(response, await turtleService.clearCache());
            return;
          }

          const body = await readJsonBody<{ limitMb?: number }>(request);
          if (!Number.isFinite(body.limitMb)) {
            writeError(response, "Cache updates require { limitMb }.");
            return;
          }

          writeJson(response, await turtleService.setCacheLimit(Number(body.limitMb)));
          return;
        }

        if (url.pathname === "/api/update/check") {
          writeJson(response, await turtleService.checkForUpdates());
          return;
        }

        if (url.pathname === "/api/show-episodes") {
          const sourceId = getRequiredParam(url, "sourceId");
          if (!sourceId) {
            writeError(response, "Missing required query parameter: sourceId");
            return;
          }

          writeJson(response, await turtleService.getEpisodesForShow(sourceId));
          return;
        }

        if (url.pathname === "/api/search") {
          const query = getRequiredParam(url, "q");
          if (!query) {
            writeError(response, "Missing required query parameter: q");
            return;
          }

          writeJson(response, await search(query));
          return;
        }

        if (url.pathname === "/api/suggest") {
          const query = getRequiredParam(url, "q");
          if (!query) {
            writeJson(response, []);
            return;
          }

          writeJson(response, await getSuggestions(query));
          return;
        }

        if (url.pathname === "/api/episodes") {
          const showId = getRequiredParam(url, "id");
          if (!showId) {
            writeError(response, "Missing required query parameter: id");
            return;
          }

          writeJson(response, await getEpisodes(showId));
          return;
        }

        if (url.pathname === "/api/stream") {
          const episodeLink = getRequiredParam(url, "link");
          if (!episodeLink) {
            writeError(response, "Missing required query parameter: link");
            return;
          }

          const streamSource = await extractStreamSource(episodeLink);
          const address = server.address();
          const apiBaseUrl = getApiBaseUrl(
            address && typeof address !== "string" ? address.port : 0,
          );

          writeJson(
            response,
            buildMediaProxyUrl(apiBaseUrl, apiKey, streamSource.url, streamSource.referer),
          );
          return;
        }

        if (url.pathname === "/health") {
          writeJson(response, { ok: true });
          return;
        }

        writeError(response, "Not found", 404);
      } catch (caughtError) {
        writeError(
          response,
          caughtError instanceof Error ? caughtError.message : "Unknown server error",
          500,
        );
      }
    });

    server.once("error", reject);
    server.listen(0, HOSTNAME, () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to determine the Turtle API port."));
        return;
      }

      resolveServer({
        port: address.port,
        stop() {
          return new Promise((resolveStop, rejectStop) => {
            server.close((closeError) => {
              if (closeError) {
                rejectStop(closeError);
                return;
              }

              resolveStop();
            });
          });
        },
      });
    });
  });
}

export async function startStandaloneServer(
  options: StartStandaloneServerOptions = {},
): Promise<StandaloneServerSession> {
  const indexPath = resolveTurtleIndexPath();
  if (!existsSync(indexPath)) {
    throw new Error(`Turtle UI was not found at ${indexPath}`);
  }

  const apiKey = randomUUID();
  const server = await startHttpServer(apiKey);
  const clientUrl = getStandaloneLaunchUrl(indexPath, server.port, apiKey).toString();

  console.log(`Turtle API listening on http://${HOSTNAME}:${server.port}`);

  if (options.openClient) {
    launchStandaloneClient(clientUrl);
  }

  return {
    apiKey,
    clientUrl,
    port: server.port,
    stop() {
      return server.stop();
    },
  };
}

if (require.main === module) {
  void startStandaloneServer({ openClient: true }).catch((startupError) => {
    console.error(
      startupError instanceof Error ? startupError.message : "Unable to start Turtle.",
    );
    process.exit(1);
  });
}
