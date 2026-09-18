import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
const background = await readFile("dist/background.js", "utf8");

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

console.log("Built manifest and background permissions look constrained.");
