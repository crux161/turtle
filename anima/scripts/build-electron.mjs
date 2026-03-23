import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const hostRoot = join(process.cwd(), "..");
const hostPackagePath = join(hostRoot, "package.json");

if (!existsSync(hostPackagePath)) {
  console.log(
    "No host package.json was found above ani-cli. Turtle is built, but Electron packaging is not configured here yet.",
  );
  process.exit(0);
}

const hostPackage = JSON.parse(readFileSync(hostPackagePath, "utf8"));
const hostScripts = hostPackage.scripts ?? {};
const target = ["electron:build", "dist"].find(
  (name) => typeof hostScripts[name] === "string",
);

if (!target) {
  console.log(
    "No Electron export script was found in the host workspace. Turtle is built, but app packaging is not configured here yet.",
  );
  process.exit(0);
}

const result = Bun.spawnSync(["bun", "run", target], {
  cwd: hostRoot,
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(result.exitCode ?? 0);
