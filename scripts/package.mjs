import JSZip from "jszip";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

const DIST = "dist";
const RELEASE = "release";
const FIXED_DATE = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await filesUnder(path));
    } else if (entry.isFile()) {
      paths.push(path);
    }
  }

  return paths;
}

function zipPath(path) {
  return relative(DIST, path).split(sep).join("/");
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(await readFile(join(DIST, "manifest.json"), "utf8"));
const version = String(packageJson.version ?? "");
const manifestVersion = String(manifest.version ?? "");

if (!version || version !== manifestVersion) {
  throw new Error(
    `Version mismatch: package.json=${version || "<missing>"} manifest=${manifestVersion || "<missing>"}.`,
  );
}

const refName = process.env.GITHUB_REF_NAME;
if (refName?.startsWith("v") && refName !== `v${version}`) {
  throw new Error(`Release tag ${refName} does not match package version v${version}.`);
}

const files = await filesUnder(DIST);
const relativeFiles = files.map(zipPath);

if (relativeFiles.some((path) => path.endsWith(".map"))) {
  throw new Error("Release build contains source maps.");
}

for (const required of [
  "manifest.json",
  "background.js",
  "content.js",
  "sidepanel.js",
  "sidepanel.html",
  "styles.css",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
]) {
  if (!relativeFiles.includes(required)) {
    throw new Error(`Release build is missing ${required}.`);
  }
}

if (manifest.content_scripts !== undefined) {
  throw new Error("Release manifest must not install persistent content scripts.");
}

const expectedHosts = [
  "http://127.0.0.1:8765/*",
  "http://localhost:8765/*",
].sort();
const actualHosts = [...(manifest.host_permissions ?? [])].sort();
if (JSON.stringify(actualHosts) !== JSON.stringify(expectedHosts)) {
  throw new Error(`Unexpected release host permissions: ${actualHosts.join(", ")}`);
}

const zip = new JSZip();
for (const path of files) {
  zip.file(zipPath(path), await readFile(path), {
    date: FIXED_DATE,
    createFolders: false,
  });
}

const archive = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
  platform: "UNIX",
});

await rm(RELEASE, { recursive: true, force: true });
await mkdir(RELEASE, { recursive: true });

const filename = `anki-cards-collector-${version}.zip`;
await writeFile(join(RELEASE, filename), archive);

console.log(`Packaged ${basename(filename)} with ${files.length} files.`);
