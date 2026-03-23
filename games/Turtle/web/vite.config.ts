import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const outputDir = mode === "gamelette"
    ? resolve(__dirname, "../dist/gamelette")
    : resolve(__dirname, "../dist/standalone");

  return {
    base: "./",
    plugins: [react()],
    build: {
      emptyOutDir: true,
      outDir: outputDir,
      sourcemap: true,
    },
    define: {
      __TURTLE_TARGET__: JSON.stringify(mode === "gamelette" ? "gamelette" : "standalone"),
    },
  };
});
