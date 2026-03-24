import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { getSuggestions } from "./scraper.js";
import { startStandaloneServer, type StandaloneServerSession } from "./server.js";

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let serverSession: StandaloneServerSession | null = null;

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

function serializeWindowState(window: BrowserWindow | null) {
  return {
    isDesktop: Boolean(window),
    isMaximized: window?.isMaximized() ?? false,
    isFullScreen: window?.isFullScreen() ?? false,
  };
}

function broadcastWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("window:state-changed", serializeWindowState(mainWindow));
}

function resolveThemeDirectory(): string {
  const bundledThemeDir = resolve(__dirname, "resources", "themes");
  if (existsSync(bundledThemeDir)) {
    return bundledThemeDir;
  }

  return resolve(__dirname, "..", "..", "resources", "themes");
}

ipcMain.handle("scraper:suggest", async (_event, query: string) => {
  return getSuggestions(typeof query === "string" ? query : "");
});

ipcMain.handle("themes:list", async () => {
  const themeDir = resolveThemeDirectory();
  const manifestPath = resolve(themeDir, "manifest.json");

  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
});

ipcMain.handle("themes:read", async (_event, filename: string) => {
  const safeName = basename(filename);
  if (!safeName) {
    throw new Error("Theme filename is required.");
  }

  return readFile(resolve(resolveThemeDirectory(), safeName), "utf8");
});

ipcMain.handle("themes:getPath", async () => {
  return resolveThemeDirectory();
});

ipcMain.handle("themes:openFolder", async () => {
  await shell.openPath(resolveThemeDirectory());
});

ipcMain.handle("window:getState", async () => {
  return serializeWindowState(mainWindow);
});

ipcMain.handle("window:minimize", async () => {
  mainWindow?.minimize();
  return serializeWindowState(mainWindow);
});

ipcMain.handle("window:toggleMaximize", async () => {
  if (!mainWindow) {
    return serializeWindowState(mainWindow);
  }

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }

  return serializeWindowState(mainWindow);
});

ipcMain.handle("window:close", async () => {
  mainWindow?.close();
});

ipcMain.handle("window:setFullScreen", async (_event, flag: boolean) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  mainWindow.setFullScreen(Boolean(flag));
  return mainWindow.isFullScreen();
});

ipcMain.handle("window:isFullScreen", async () => {
  return mainWindow?.isFullScreen() ?? false;
});

async function ensureServerSession(): Promise<StandaloneServerSession> {
  if (!serverSession) {
    serverSession = await startStandaloneServer();
  }

  return serverSession;
}

function resolveResourcePath(...segments: string[]): string {
  // In packaged builds, resources land in process.resourcesPath
  // In dev, they're in dist/resources
  const packaged = resolve(process.resourcesPath, ...segments);
  if (existsSync(packaged)) {
    return packaged;
  }

  return resolve(__dirname, "resources", ...segments);
}

function resolveAppIcon(): string | undefined {
  const icns = resolveResourcePath("turtle.icns");
  if (existsSync(icns)) {
    return icns;
  }

  return undefined;
}

async function showSplashScreen(): Promise<BrowserWindow> {
  const splashPath = resolveResourcePath("splash-v1.png");
  const iconPath = resolveAppIcon();

  const splash = new BrowserWindow({
    width: 828,
    height: 600,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    ...(iconPath ? { icon: nativeImage.createFromPath(iconPath) } : {}),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  const toFileUrl = (p: string) => `file://${p.replace(/\\/g, "/")}`;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; -webkit-app-region: drag; }
  .splash { width: 100%; height: 100%; }
  .splash img { width: 100%; height: 100%; object-fit: cover; border-radius: 12px; }
</style>
</head>
<body>
  <div class="splash">
    <img src="${toFileUrl(splashPath)}" alt="Turtle" />
  </div>
</body>
</html>`;

  const splashHtmlPath = resolve(app.getPath("temp"), "turtle-splash.html");
  await writeFile(splashHtmlPath, html, "utf8");
  await splash.loadFile(splashHtmlPath);
  splash.once("ready-to-show", () => splash.show());
  splash.show();
  splashWindow = splash;

  return splash;
}

async function createMainWindow(): Promise<void> {
  const session = await ensureServerSession();
  const iconPath = resolveAppIcon();

  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#101115",
    autoHideMenuBar: true,
    frame: false,
    show: false,
    title: "Turtle",
    ...(iconPath ? { icon: nativeImage.createFromPath(iconPath) } : {}),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: resolve(__dirname, "preload.js"),
    },
  });

  mainWindow = window;

  window.once("ready-to-show", () => {
    window.show();
    broadcastWindowState();

    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
  });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  window.on("maximize", () => broadcastWindowState());
  window.on("unmaximize", () => broadcastWindowState());
  window.on("enter-full-screen", () => broadcastWindowState());
  window.on("leave-full-screen", () => broadcastWindowState());

  await window.loadURL(session.clientUrl);
}

app
  .whenReady()
  .then(async () => {
    await showSplashScreen();

    // Begin server init in parallel with the splash display
    const serverReady = ensureServerSession();

    // Ensure at least 3 seconds of splash visibility
    const splashMinDelay = new Promise<void>((resolve) => setTimeout(resolve, 3000));

    await Promise.all([serverReady, splashMinDelay]);
    await createMainWindow();

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
      }
    });
  })
  .catch((startupError) => {
    const message =
      startupError instanceof Error ? startupError.message : "Unable to launch Turtle.";
    dialog.showErrorBox("Turtle Launch Error", message);
    console.error(
      message,
    );
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverSession) {
    void serverSession.stop();
    serverSession = null;
  }
});
