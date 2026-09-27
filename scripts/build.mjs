import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { generateBrandIcons } from "./generate-brand-icons.mjs";

const e2e = process.env.COLLECTOR_E2E === "1";
const release = process.env.COLLECTOR_RELEASE === "1";
if (e2e && release) {
  throw new Error("COLLECTOR_E2E and COLLECTOR_RELEASE are mutually exclusive build modes.");
}

const productionRuntime = !e2e;
const nodeEnv = productionRuntime ? "production" : "development";
const sourcemap = release ? false : true;
const define = {
  __COLLECTOR_E2E__: JSON.stringify(e2e),
  "process.env.NODE_ENV": JSON.stringify(nodeEnv),
};

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
    sourcemap,
    minifySyntax: true,
    define,
  }),
  build({
    entryPoints: ["src/content.ts"],
    bundle: true,
    outfile: "dist/content.js",
    format: "iife",
    platform: "browser",
    target: "chrome120",
    sourcemap,
    minifySyntax: true,
    define,
  }),
  build({
    entryPoints: ["src/sidepanel/main.tsx"],
    bundle: true,
    outfile: "dist/sidepanel.js",
    format: "iife",
    platform: "browser",
    target: "chrome120",
    sourcemap,
    minifySyntax: true,
    define,
  }),
]);

const manifest = JSON.parse(await readFile("public/manifest.json", "utf8"));
if (e2e) {
  manifest.host_permissions = [
    ...manifest.host_permissions,
    "http://127.0.0.1/*",
  ];
}
await writeFile("dist/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

await Promise.all([
  cp("public/sidepanel.html", "dist/sidepanel.html"),
  cp("public/styles.css", "dist/styles.css"),
  generateBrandIcons("dist/icons"),
]);

const mode = e2e ? "E2E/development" : release ? "release/production" : "production";
console.log(`Built ${mode} extension (NODE_ENV=${nodeEnv}) into dist/`);
