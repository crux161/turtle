import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { getSuggestions } from "./scraper.js";
import { startStandaloneServer, type StandaloneServerSession } from "./server.js";

let mainWindow: BrowserWindow | null = null;
let serverSession: StandaloneServerSession | null = null;

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

function serializeWindowState(window: BrowserWindow | null) {
  return {
    isDesktop: Boolean(window),
    isMaximized: window?.isMaximized() ?? false,
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

async function ensureServerSession(): Promise<StandaloneServerSession> {
  if (!serverSession) {
    serverSession = await startStandaloneServer();
  }

  return serverSession;
}

async function createMainWindow(): Promise<void> {
  const session = await ensureServerSession();

  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#101115",
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: "hidden",
    show: false,
    title: "Turtle",
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
