import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { buildDeterministicZip } from "./deterministic-zip.mjs";

const dist = resolve("dist");
const releaseDir = resolve("release");
const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
const archiveName = `anki-cards-collector-${manifest.version}.zip`;
const archivePath = join(releaseDir, archiveName);
const checksumPath = `${archivePath}.sha256`;

async function filesUnder(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await filesUnder(absolute, relative));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files.sort();
}

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

const files = await filesUnder(dist);
if (!files.includes("manifest.json")) {
  throw new Error("dist/manifest.json is missing; build the release package first.");
}

const entries = [];
for (const file of files) {
  entries.push({
    name: file,
    data: await readFile(join(dist, file)),
  });
}

const archive = buildDeterministicZip(entries);
const hash = createHash("sha256").update(archive).digest("hex");
await writeFile(archivePath, archive);
await writeFile(checksumPath, `${hash}  ${basename(archivePath)}\n`);

const archiveStat = await stat(archivePath);
console.log(`Created ${archiveName} (${archiveStat.size} bytes)`);
console.log(`SHA-256: ${hash}`);
