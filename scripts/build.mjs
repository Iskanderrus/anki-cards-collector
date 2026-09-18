import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await Promise.all([
  build({
    entryPoints: ["src/background.ts"],
    bundle: true,
    outfile: "dist/background.js",
    format: "esm",
    platform: "browser",
    target: "chrome120",
    sourcemap: true,
  }),
  build({
    entryPoints: ["src/content.ts"],
    bundle: true,
    outfile: "dist/content.js",
    format: "iife",
    platform: "browser",
    target: "chrome120",
    sourcemap: true,
  }),
  build({
    entryPoints: ["src/sidepanel/main.tsx"],
    bundle: true,
    outfile: "dist/sidepanel.js",
    format: "iife",
    platform: "browser",
    target: "chrome120",
    sourcemap: true,
  }),
]);

await cp("public/manifest.json", "dist/manifest.json");
await cp("public/sidepanel.html", "dist/sidepanel.html");
await cp("public/styles.css", "dist/styles.css");

console.log("Built extension into dist/");
