import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "..");
const sourceDir = resolve(projectDir, "..", "games", "Turtle");
const targetDir = resolve(projectDir, "dist", "games", "Turtle");
const themeSourceDir = resolve(projectDir, "..", "resources", "themes");
const themeTargetDir = resolve(projectDir, "dist", "resources", "themes");

await rm(targetDir, { recursive: true, force: true });
await rm(themeTargetDir, { recursive: true, force: true });
await mkdir(resolve(projectDir, "dist", "games"), { recursive: true });
await mkdir(targetDir, { recursive: true });
await mkdir(resolve(projectDir, "dist", "resources"), { recursive: true });

for (const entry of ["manifest.json", "index.html", "dist"]) {
  const sourcePath = resolve(sourceDir, entry);
  if (!existsSync(sourcePath)) {
    continue;
  }

  await cp(sourcePath, resolve(targetDir, entry), {
    force: true,
    recursive: true,
  });
}

if (existsSync(themeSourceDir)) {
  await cp(themeSourceDir, themeTargetDir, {
    force: true,
    recursive: true,
  });
}

console.log(`Copied packaged Turtle assets to ${targetDir}`);
