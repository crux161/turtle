import { existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const turtleDir = resolve(scriptDir, "..");
const workspaceDir = resolve(turtleDir, "..", "..");
const standaloneDistDir = resolve(workspaceDir, "ani-cli", "dist");
const gameletteBuildDir = resolve(turtleDir, "dist", "gamelette");
const exportDir = resolve(turtleDir, "export", "Proteus", "Turtle");

if (!existsSync(gameletteBuildDir)) {
  throw new Error(`Gamelette frontend build is missing at ${gameletteBuildDir}. Run the Turtle build first.`);
}

if (!existsSync(standaloneDistDir)) {
  throw new Error(`ani-cli build output is missing at ${standaloneDistDir}. Run the Turtle build first.`);
}

await rm(exportDir, { recursive: true, force: true });
await mkdir(exportDir, { recursive: true });

await cp(gameletteBuildDir, exportDir, {
  force: true,
  recursive: true,
});

await mkdir(resolve(exportDir, "dist"), { recursive: true });
for (const fileName of [
  "index.d.ts",
  "index.js",
  "index.js.map",
  "scraper.d.ts",
  "scraper.js",
  "scraper.js.map",
]) {
  const sourcePath = resolve(standaloneDistDir, fileName);
  if (!existsSync(sourcePath)) {
    continue;
  }

  await cp(sourcePath, resolve(exportDir, "dist", fileName), {
    force: true,
    recursive: false,
  });
}

const scraperSourcePath = resolve(workspaceDir, "ani-cli", "src", "scraper.ts");
if (existsSync(scraperSourcePath)) {
  await mkdir(resolve(exportDir, "src"), { recursive: true });
  await cp(scraperSourcePath, resolve(exportDir, "src", "scraper.ts"), {
    force: true,
    recursive: false,
  });
}

await writeFile(
  resolve(exportDir, "manifest.json"),
  `${JSON.stringify({
    id: "turtle",
    name: "Turtle",
    description: "Watch Party Engine",
    type: "iframe",
    entry: "index.html",
    icon: "🐢",
    version: "1.0.0",
    color: "#6b9362",
  }, null, 2)}\n`,
  "utf8",
);

await writeFile(
  resolve(exportDir, "package.json"),
  `${JSON.stringify({ type: "module" }, null, 2)}\n`,
  "utf8",
);

console.log(`Exported Proteus-ready Turtle bundle to ${exportDir}`);
