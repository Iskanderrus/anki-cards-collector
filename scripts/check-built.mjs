import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
const background = await readFile("dist/background.js", "utf8");

function pngDimensions(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  assert.equal(signature, "89504e470d0a1a0a", "Icon must be a PNG file.");
  assert.equal(
    buffer.subarray(12, 16).toString("ascii"),
    "IHDR",
    "PNG is missing IHDR.",
  );
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

assert.equal(
  manifest.content_scripts,
  undefined,
  "Production manifest must not install persistent content scripts.",
);

for (const permission of ["activeTab", "contextMenus", "scripting", "sidePanel", "storage"]) {
  assert.ok(
    manifest.permissions?.includes(permission),
    `Production manifest is missing required permission: ${permission}`,
  );
}

const hosts = manifest.host_permissions ?? [];
for (const broadPattern of ["<all_urls>", "*://*/*", "http://*/*", "https://*/*"]) {
  assert.ok(
    !hosts.includes(broadPattern),
    `Production manifest must not contain broad host permission ${broadPattern}.`,
  );
}

assert.deepEqual(
  hosts.sort(),
  ["http://127.0.0.1:8765/*", "http://localhost:8765/*"].sort(),
  "Production host permissions must stay limited to localhost AnkiConnect.",
);

assert.ok(
  !background.includes("E2E_CONTEXT_MENU_CLICK"),
  "Production background bundle must not contain the E2E context-menu hook.",
);

const iconEntries = new Map();
for (const [size, path] of Object.entries(manifest.icons ?? {})) {
  iconEntries.set(path, Number(size));
}
for (const [size, path] of Object.entries(manifest.action?.default_icon ?? {})) {
  const numericSize = Number(size);
  const existing = iconEntries.get(path);
  if (existing !== undefined) {
    assert.equal(existing, numericSize, `${path} has inconsistent manifest sizes.`);
  }
  iconEntries.set(path, numericSize);
}

assert.ok(iconEntries.size > 0, "Production manifest must declare extension icons.");

for (const [path, size] of iconEntries) {
  const buffer = await readFile(join("dist", path));
  assert.deepEqual(
    pngDimensions(buffer),
    { width: size, height: size },
    `${path} must be exactly ${size}x${size}.`,
  );
}

console.log("Built manifest, permissions, and brand icons look constrained.");
