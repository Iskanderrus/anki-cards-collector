import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const dist = resolve("dist");
const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile("package.json", "utf8"));

function sameStrings(actual, expected, label) {
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    label,
  );
}

function pngDimensions(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  assert.equal(signature, "89504e470d0a1a0a", "Icon must be a PNG file.");
  assert.equal(buffer.subarray(12, 16).toString("ascii"), "IHDR", "PNG is missing IHDR.");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function filesUnder(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await filesUnder(join(directory, entry.name), relative));
    } else {
      files.push(relative);
    }
  }
  return files.sort();
}

assert.equal(manifest.manifest_version, 3, "Store package must use Manifest V3.");
assert.equal(packageJson.version, manifest.version, "package.json and manifest versions must match.");
assert.equal(typeof manifest.name, "string");
assert.ok(manifest.name.length > 0 && manifest.name.length <= 45, "Manifest name must be 1-45 characters.");
assert.equal(typeof manifest.short_name, "string");
assert.ok(manifest.short_name.length <= 12, "short_name should stay within 12 characters.");
assert.equal(typeof manifest.description, "string");
assert.ok(manifest.description.length <= 132, "Manifest description must not exceed 132 characters.");
assert.match(
  manifest.version,
  /^\d+(?:\.\d+){0,3}$/,
  "Manifest version must contain one to four dot-separated integers.",
);
assert.equal(
  manifest.minimum_chrome_version,
  "120",
  "minimum_chrome_version must match the current build target.",
);

sameStrings(
  manifest.permissions ?? [],
  ["activeTab", "contextMenus", "scripting", "sidePanel", "storage"],
  "Store permissions changed unexpectedly.",
);
sameStrings(
  manifest.host_permissions ?? [],
  ["http://127.0.0.1:8765/*", "http://localhost:8765/*"],
  "Store host permissions must stay limited to AnkiConnect on localhost.",
);
assert.equal(manifest.content_scripts, undefined, "Store package must not install persistent content scripts.");

const manifestIcons = {
  16: "icons/icon16.png",
  32: "icons/icon32.png",
  48: "icons/icon48.png",
  128: "icons/icon128.png",
};
assert.deepEqual(manifest.icons, manifestIcons, "Manifest icons changed unexpectedly.");

const actionIcons = {
  16: "icons/icon16.png",
  32: "icons/icon32.png",
  48: "icons/icon48.png",
};
assert.deepEqual(manifest.action?.default_icon, actionIcons, "Action icons changed unexpectedly.");

const iconEntries = new Map();
for (const [sizeText, path] of Object.entries({ ...manifestIcons, ...actionIcons })) {
  iconEntries.set(path, Number(sizeText));
}

for (const [path, size] of iconEntries) {
  const buffer = await readFile(join(dist, path));
  const dimensions = pngDimensions(buffer);
  assert.deepEqual(
    dimensions,
    { width: size, height: size },
    `${path} must be exactly ${size}x${size}.`,
  );
}

const files = await filesUnder(dist);
for (const file of files) {
  assert.ok(!file.endsWith(".map"), `Store package must not contain source map: ${file}`);
  assert.ok(!file.endsWith(".ts") && !file.endsWith(".tsx"), `Store package contains source file: ${file}`);
}
assert.ok(files.includes("manifest.json"), "manifest.json must be at the package root.");
assert.ok(files.includes("background.js"), "background.js is missing.");
assert.ok(files.includes("content.js"), "content.js is missing.");
assert.ok(files.includes("sidepanel.js"), "sidepanel.js is missing.");

const expectedStoreFiles = [
  "background.js",
  "content.js",
  "icons/icon128.png",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "manifest.json",
  "sidepanel.html",
  "sidepanel.js",
  "styles.css",
];
sameStrings(files, expectedStoreFiles, "Store package file allowlist changed unexpectedly.");

const jsBundles = ["background.js", "content.js", "sidepanel.js"];
const forbiddenSignatures = [
  "E2E_CONTEXT_MENU_CLICK",
  "E2eCanonicalFormProvider",
  "e2e-fixture",
  "Deterministic browser-test fixture.",
  "Synthetic provider failure.",
  "delaylemma",
  "oldlemma",
  "newlemma",
  "createE2eCanonicalFormProvider",
  "react.development.js",
  "react-dom.development.js",
  "scheduler.development.js",
];

for (const bundleName of jsBundles) {
  const source = await readFile(join(dist, bundleName), "utf8");
  for (const signature of forbiddenSignatures) {
    assert.ok(
      !source.includes(signature),
      `Store ${bundleName} must not contain forbidden signature: ${signature}`,
    );
  }
}

const sidepanel = await readFile(join(dist, "sidepanel.js"), "utf8");
assert.ok(
  !sidepanel.includes("react.development") && !sidepanel.includes("scheduler.development"),
  "Store sidepanel bundle must use the production React runtime.",
);

console.log(`Store package validation passed for ${files.length} files (v${manifest.version}).`);
