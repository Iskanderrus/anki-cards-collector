import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const e2e = process.env.COLLECTOR_E2E === "1";

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
    define: {
      __COLLECTOR_E2E__: JSON.stringify(e2e),
    },
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

const manifest = JSON.parse(await readFile("public/manifest.json", "utf8"));
if (e2e) {
  manifest.host_permissions = [
    ...manifest.host_permissions,
    "http://127.0.0.1/*",
  ];
}
await writeFile("dist/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

await cp("public/sidepanel.html", "dist/sidepanel.html");
await cp("public/styles.css", "dist/styles.css");

console.log(`Built ${e2e ? "E2E" : "production"} extension into dist/`);
