import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const dist = resolve("dist");
const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile("package.json", "utf8"));

function sameStrings(actual, expected, label) {
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);
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
assert.match(manifest.version, /^\d+(?:\.\d+){0,3}$/, "Manifest version must contain one to four dot-separated integers.");
assert.equal(manifest.minimum_chrome_version, "120", "minimum_chrome_version must match the current build target.");

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
sameStrings(
  manifest.optional_host_permissions ?? [],
  ["https://duolingo.com/*", "https://*.duolingo.com/*"],
  "Optional host permissions changed unexpectedly.",
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
  assert.deepEqual(pngDimensions(buffer), { width: size, height: size }, `${path} must be exactly ${size}x${size}.`);
}

const files = await filesUnder(dist);
const expectedFiles = [
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
].sort();
assert.deepEqual(files, expectedFiles, "Store package file allowlist changed unexpectedly.");

for (const file of files) {
  assert.ok(!file.endsWith(".map"), `Store package must not contain source map: ${file}`);
  assert.ok(!file.endsWith(".ts") && !file.endsWith(".tsx"), `Store package contains source file: ${file}`);
  assert.ok(!/(^|\/)(?:tests?|__tests__)(\/|$)/i.test(file), `Store package contains test content: ${file}`);
}

const jsFiles = files.filter((file) => file.endsWith(".js"));
const bundles = new Map();
for (const file of jsFiles) {
  bundles.set(file, await readFile(join(dist, file), "utf8"));
}

const forbiddenReleaseSignatures = [
  "node_modules/react/cjs/react.development.js",
  "node_modules/react/cjs/react-jsx-runtime.development.js",
  "node_modules/react-dom/cjs/react-dom.development.js",
  "node_modules/react-dom/cjs/react-dom-client.development.js",
  "node_modules/scheduler/cjs/scheduler.development.js",
  "Download the React DevTools for a better development experience",
  "This is a development build of React",
  "__COLLECTOR_E2E__",
  "COLLECTOR_E2E",
  "E2E_CONTEXT_MENU_CLICK",
];
for (const [file, source] of bundles) {
  for (const signature of forbiddenReleaseSignatures) {
    assert.ok(!source.includes(signature), `Store bundle ${file} contains forbidden development/E2E signature: ${signature}`);
  }
}

const sidepanel = bundles.get("sidepanel.js");
assert.ok(sidepanel, "sidepanel.js is missing.");
for (const marker of [
  "node_modules/react/cjs/react.production.js",
  "node_modules/react/cjs/react-jsx-runtime.production.js",
  "node_modules/react-dom/cjs/react-dom-client.production.js",
  "node_modules/scheduler/cjs/scheduler.production.js",
]) {
  assert.ok(sidepanel.includes(marker), `Store sidepanel bundle is missing expected production runtime marker: ${marker}`);
}
assert.ok(!sidepanel.includes("process.env.NODE_ENV"), "Store sidepanel bundle must resolve NODE_ENV at build time.");

console.log(`Store package validation passed for ${files.length} files (v${manifest.version}) with production React runtime.`);
