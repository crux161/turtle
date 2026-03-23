import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let resolvedDataDir: string | null = null;

export function getTurtleDataDir(): string {
  if (resolvedDataDir) {
    return resolvedDataDir;
  }

  const envPath = process.env.TURTLE_DATA_DIR?.trim();
  if (envPath) {
    resolvedDataDir = envPath;
    mkdirSync(resolvedDataDir, { recursive: true });
    return resolvedDataDir;
  }

  const home = homedir();
  if (process.platform === "darwin") {
    resolvedDataDir = join(home, "Library", "Application Support", "Turtle");
  } else if (process.platform === "win32") {
    resolvedDataDir = join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Turtle");
  } else {
    resolvedDataDir = join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "turtle");
  }

  mkdirSync(resolvedDataDir, { recursive: true });
  return resolvedDataDir;
}

export function getTurtleStateFilePath(): string {
  return join(getTurtleDataDir(), "state.json");
}

export function getTurtleCacheDir(): string {
  const cacheDir = join(getTurtleDataDir(), "cache", "images");
  mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

export function getTurtleCacheIndexPath(): string {
  const cacheRoot = join(getTurtleDataDir(), "cache");
  mkdirSync(cacheRoot, { recursive: true });
  return join(cacheRoot, "index.json");
}
