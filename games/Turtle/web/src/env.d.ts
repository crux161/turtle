declare const __TURTLE_TARGET__: "standalone" | "gamelette";

declare global {
  interface Window {
    api?: {
      scraper?: {
        suggest?: (query: string) => Promise<unknown>;
      };
      window?: {
        getState?: () => Promise<{ isDesktop: boolean; isMaximized: boolean; isFullScreen: boolean }>;
        minimize?: () => Promise<{ isDesktop: boolean; isMaximized: boolean; isFullScreen: boolean }>;
        toggleMaximize?: () => Promise<{ isDesktop: boolean; isMaximized: boolean; isFullScreen: boolean }>;
        close?: () => Promise<void>;
        setFullScreen?: (flag: boolean) => Promise<boolean>;
        isFullScreen?: () => Promise<boolean>;
        onStateChanged?: (
          listener: (state: { isDesktop: boolean; isMaximized: boolean; isFullScreen: boolean }) => void,
        ) => (() => void);
      };
    };
    bergamot?: {
      platform?: string;
      versions?: {
        electron?: string;
        node?: string;
        chrome?: string;
      };
      getAvailableThemes?: () => Promise<string[]>;
      getThemeCss?: (filename: string) => Promise<string>;
      getThemesPath?: () => Promise<string>;
      openThemesFolder?: () => Promise<void>;
      onThemesChanged?: (
        listener: (payload: { filename: string | null; themes: string[] }) => void,
      ) => (() => void);
    };
  }
}

export {};
