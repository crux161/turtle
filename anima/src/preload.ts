import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  scraper: {
    suggest(query: string) {
      return ipcRenderer.invoke("scraper:suggest", query);
    },
  },
  window: {
    getState() {
      return ipcRenderer.invoke("window:getState");
    },
    minimize() {
      return ipcRenderer.invoke("window:minimize");
    },
    toggleMaximize() {
      return ipcRenderer.invoke("window:toggleMaximize");
    },
    close() {
      return ipcRenderer.invoke("window:close");
    },
    setFullScreen(flag: boolean) {
      return ipcRenderer.invoke("window:setFullScreen", flag);
    },
    isFullScreen() {
      return ipcRenderer.invoke("window:isFullScreen");
    },
    onStateChanged(listener: (state: { isDesktop: boolean; isMaximized: boolean; isFullScreen: boolean }) => void) {
      const wrapped = (
        _event: Electron.IpcRendererEvent,
        state: { isDesktop: boolean; isMaximized: boolean; isFullScreen: boolean },
      ) => {
        listener(state);
      };

      ipcRenderer.on("window:state-changed", wrapped);
      return () => ipcRenderer.removeListener("window:state-changed", wrapped);
    },
  },
});

contextBridge.exposeInMainWorld("bergamot", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
  getAvailableThemes: (): Promise<string[]> => ipcRenderer.invoke("themes:list"),
  getThemeCss: (filename: string): Promise<string> => ipcRenderer.invoke("themes:read", filename),
  getThemesPath: (): Promise<string> => ipcRenderer.invoke("themes:getPath"),
  openThemesFolder: (): Promise<void> => ipcRenderer.invoke("themes:openFolder"),
  onThemesChanged: (): (() => void) => {
    return () => {};
  },
});
