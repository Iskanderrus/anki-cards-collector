/**
 * Adversarial reproducibility gate for the Chrome Web Store ZIP.
 *
 * Proves that identical source/build payload yields byte-identical ZIP bytes
 * across distinct workspace paths, umask values, file mtimes, and irrelevant
 * SOURCE_DATE_EPOCH values. Compares final ZIP SHA-256, not extracted contents.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PACKAGE_SOURCE_DATE_EPOCH } from "./deterministic-zip.mjs";

const dist = resolve("dist");

async function filesUnder(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await filesUnder(join(directory, entry.name), relative));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files.sort();
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function packageDistCopy({
  label,
  umaskOctal,
  sourceDateEpoch,
  mtimeEpochSeconds,
  chmodMode,
}) {
  const workspace = await mkdtemp(join(tmpdir(), `accp023-${label}-`));
  const distCopy = join(workspace, "dist");
  const releaseDir = join(workspace, "release");
  const packageScript = join(workspace, "scripts", "package-release.mjs");
  const zipHelper = join(workspace, "scripts", "deterministic-zip.mjs");

  await mkdir(join(workspace, "scripts"), { recursive: true });
  await cp(dist, distCopy, { recursive: true });
  await cp(resolve("scripts/package-release.mjs"), packageScript);
  await cp(resolve("scripts/deterministic-zip.mjs"), zipHelper);

  const files = await filesUnder(distCopy);
  for (const file of files) {
    const absolute = join(distCopy, file);
    spawnSync("touch", ["-d", `@${mtimeEpochSeconds}`, absolute], { stdio: "ignore" });
    spawnSync("chmod", [chmodMode, absolute], { stdio: "ignore" });
  }

  // Stale prior release/ state must not affect the result.
  await mkdir(releaseDir, { recursive: true });
  await writeFile(join(releaseDir, "stale-noise.bin"), Buffer.from(`noise-${label}-${Date.now()}`));

  const umasked = spawnSync(
    "bash",
    [
      "-lc",
      `umask ${umaskOctal} && export SOURCE_DATE_EPOCH=${sourceDateEpoch} && ${JSON.stringify(process.execPath)} ${JSON.stringify(packageScript)}`,
    ],
    {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        SOURCE_DATE_EPOCH: String(sourceDateEpoch),
      },
    },
  );

  if (umasked.status !== 0) {
    throw new Error(
      `package-release failed for ${label} (exit ${umasked.status}):\n${umasked.stdout}\n${umasked.stderr}`,
    );
  }

  const zips = (await readdir(releaseDir)).filter((name) => name.endsWith(".zip"));
  assert.equal(zips.length, 1, `${label} must produce exactly one ZIP`);
  const zipPath = join(releaseDir, zips[0]);
  const hash = await sha256File(zipPath);
  const size = (await readFile(zipPath)).length;

  return { label, workspace, zipPath, hash, size, files: files.length };
}

const distFiles = await filesUnder(dist);
assert.ok(distFiles.includes("manifest.json"), "dist/ must contain a release build before this check.");

const builds = [
  await packageDistCopy({
    label: "a",
    umaskOctal: "0002",
    sourceDateEpoch: 1,
    mtimeEpochSeconds: 1_000_000_000,
    chmodMode: "0600",
  }),
  await packageDistCopy({
    label: "b",
    umaskOctal: "0077",
    sourceDateEpoch: 1_700_000_000,
    mtimeEpochSeconds: 1_800_000_000,
    chmodMode: "0777",
  }),
  await packageDistCopy({
    label: "c",
    umaskOctal: "0022",
    sourceDateEpoch: PACKAGE_SOURCE_DATE_EPOCH,
    mtimeEpochSeconds: 946_684_800,
    chmodMode: "0644",
  }),
];

try {
  assert.equal(builds[0].hash, builds[1].hash, "Build A and B ZIP SHA-256 must match under adversarial env.");
  assert.equal(builds[1].hash, builds[2].hash, "Build B and C ZIP SHA-256 must match under adversarial env.");
  assert.equal(builds[0].size, builds[1].size);
  assert.equal(builds[1].size, builds[2].size);

  console.log("Adversarial package reproducibility passed.");
  console.log(`BUILD_A_SHA256=${builds[0].hash}`);
  console.log(`BUILD_B_SHA256=${builds[1].hash}`);
  console.log(`BUILD_C_SHA256=${builds[2].hash}`);
  console.log(`PACKAGE_SIZE=${builds[0].size}`);
  console.log(`PACKAGE_FILES=${builds[0].files}`);
  console.log("REPRO_DIFFERENT_WORKSPACES=PASS");
  console.log("REPRO_DIFFERENT_UMASK=PASS");
  console.log("REPRO_DIFFERENT_MTIMES=PASS");
  console.log("REPRO_DIFFERENT_SOURCE_DATE_EPOCH=PASS");
} finally {
  await Promise.all(builds.map((build) => rm(build.workspace, { recursive: true, force: true })));
}
