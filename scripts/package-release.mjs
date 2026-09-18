import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const dist = resolve("dist");
const releaseDir = resolve("release");
const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
const archiveName = `anki-cards-collector-${manifest.version}.zip`;
const archivePath = join(releaseDir, archiveName);
const checksumPath = `${archivePath}.sha256`;
const sourceDateEpoch = Number(process.env.SOURCE_DATE_EPOCH ?? 946684800);
const fixedDate = new Date(sourceDateEpoch * 1000);

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

for (const file of files) {
  await utimes(join(dist, file), fixedDate, fixedDate);
}

const zipped = spawnSync(
  "zip",
  ["-X", "-q", archivePath, "-@"],
  {
    cwd: dist,
    encoding: "utf8",
    input: `${files.join("\n")}\n`,
  },
);

if (zipped.error) {
  throw new Error(
    `Could not run the system zip command: ${zipped.error.message}. Install zip and retry.`,
  );
}
if (zipped.status !== 0) {
  throw new Error(`zip failed with exit code ${zipped.status}: ${zipped.stderr}`);
}

const archive = await readFile(archivePath);
const hash = createHash("sha256").update(archive).digest("hex");
await writeFile(checksumPath, `${hash}  ${basename(archivePath)}\n`);

const archiveStat = await stat(archivePath);
console.log(`Created ${archiveName} (${archiveStat.size} bytes)`);
console.log(`SHA-256: ${hash}`);
