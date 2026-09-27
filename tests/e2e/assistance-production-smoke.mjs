import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const extensionPath = resolve("dist");
const manifest = JSON.parse(await readFile(join(extensionPath, "manifest.json"), "utf8"));

assert.equal(
  manifest.host_permissions.includes("http://127.0.0.1/*"),
  false,
  "Production smoke must use the normal constrained manifest, not the E2E manifest.",
);
assert.ok(
  manifest.host_permissions.includes("http://127.0.0.1:8765/*"),
  "The local AnkiConnect origin should remain the only localhost fixture origin available in production.",
);

const fixtureHtml = `<!doctype html>
<html>
  <head><title>ACCP-006 production smoke</title></head>
  <body>
    <main>
      <p id="base">Quiero estar en casa para estudiar con calma esta tarde.</p>
      <p id="observed">Hoy estoy en casa y tengo bastante tiempo para estudiar español.</p>
    </main>
  </body>
</html>`;

const server = createServer((request, response) => {
  if (request.method === "POST") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ result: 6, error: null }));
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(fixtureHtml);
});

await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(8765, "127.0.0.1", resolveListen);
});

const userDataDir = await mkdtemp(join(tmpdir(), "collector-accp006-production-"));
let context;

async function selectText(page, selector, phrase) {
  await page.evaluate(({ selector: targetSelector, phrase: targetPhrase }) => {
    const element = document.querySelector(targetSelector);
    if (!element?.firstChild) throw new Error(`Missing fixture element ${targetSelector}.`);
    const text = element.firstChild.textContent ?? "";
    const start = text.indexOf(targetPhrase);
    if (start < 0) throw new Error(`Phrase "${targetPhrase}" is missing from fixture.`);

    const range = document.createRange();
    range.setStart(element.firstChild, start);
    range.setEnd(element.firstChild, start + targetPhrase.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, { selector, phrase });
}

async function clickPanelButton(panel, name) {
  await panel.evaluate((buttonName) => {
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim() === buttonName);
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Button "${buttonName}" not found.`);
    }
    button.click();
  }, name);
}

async function ensureQueue(panel) {
  if (await panel.locator(".queue").count() === 0) {
    await panel.getByRole("button", { name: "Inbox", exact: true }).click();
  }
  await panel.locator(".queue").waitFor();
}

async function setCaptureLanguage(panel, language) {
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel.locator(".settings").waitFor();
  const advanced = panel.locator(".advanced-settings");
  await advanced.evaluate((node) => {
    if (node instanceof HTMLDetailsElement) node.open = true;
  });
  const input = panel.getByPlaceholder("es, sr, he…");
  await input.fill(language);
  await panel.waitForFunction(async (expectedLanguage) => {
    const stored = await chrome.storage.local.get("collectorSettings");
    return stored.collectorSettings?.defaultLanguage === expectedLanguage;
  }, language);
  await ensureQueue(panel);
}

async function cardForTerm(panel, term) {
  await ensureQueue(panel);
  const row = panel.locator(".queue-row").filter({
    has: panel.locator(".term", { hasText: term }),
  });
  await row.waitFor();
  await row.click();
  const card = panel.locator(".detail-card").filter({
    has: panel.locator(".term", { hasText: term }),
  });
  await card.waitFor();
  return card;
}

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    colorScheme: "light",
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;

  const contentPage = await context.newPage();
  await contentPage.goto("http://127.0.0.1:8765/fixture");

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.locator("h1").waitFor();

  const onboarding = panel.getByRole("dialog", { name: "Collect without breaking your reading" });
  await onboarding.waitFor();
  await onboarding.getByRole("button", { name: "Skip introduction" }).click();
  await onboarding.waitFor({ state: "detached" });

  await setCaptureLanguage(panel, "es");

  await selectText(contentPage, "#base", "estar");
  await contentPage.bringToFront();
  await clickPanelButton(panel, "Collect");
  await panel.locator(".queue-row .term", { hasText: /^estar$/ }).waitFor();

  await selectText(contentPage, "#observed", "estoy");
  await contentPage.bringToFront();
  await clickPanelButton(panel, "Collect");

  let card = await cardForTerm(panel, "estoy");
  const lexicalId = await card.getAttribute("data-card-id");
  const observedBefore = await card.locator(".canonical-evidence").innerText();
  assert.match(observedBefore, /estoy/i);

  await card.getByRole("button", { name: "Ready" }).click();
  await card.locator(".card-head > .pill", { hasText: "ready" }).waitFor();

  let assistance = card.locator(".canonical-assistance");
  await assistance.getByRole("button", { name: "Suggest canonical form" }).click();
  await assistance.getByText("Suggestion", { exact: true }).waitFor();
  assert.match(await assistance.innerText(), /estar/);

  await assistance.getByRole("button", { name: "Dismiss" }).click();
  assert.equal(await card.locator(".term").innerText(), "estoy");
  assert.match(await card.locator(".card-head > .pill").innerText(), /ready/i);
  assert.match(await card.locator(".canonical-evidence").innerText(), /estoy/i);

  await assistance.getByRole("button", { name: "Suggest canonical form" }).click();
  await assistance.getByText("Suggestion", { exact: true }).waitFor();

  const accessibility = await new AxeBuilder({ page: panel })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  assert.equal(
    accessibility.violations.length,
    0,
    "Production canonical assistance accessibility violations:\n"
      + JSON.stringify(accessibility.violations, null, 2),
  );

  await mkdir("artifacts/accp006", { recursive: true });
  await panel.setViewportSize({ width: 640, height: 520 });
  await panel.screenshot({
    path: "artifacts/accp006/production-assistance.png",
    fullPage: false,
  });

  await assistance.getByRole("button", { name: "Use suggestion" }).click();
  card = panel.locator(`[data-card-id="${lexicalId}"]`);
  await card.locator(".term", { hasText: /^estar$/ }).waitFor();
  await card.locator(".card-head > .pill", { hasText: "inbox" }).waitFor();
  assert.match(await card.locator(".canonical-evidence").innerText(), /estoy/i);

  await ensureQueue(panel);
  const sameCanonicalRows = panel.locator(".queue-row").filter({
    has: panel.locator(".term", { hasText: /^estar$/ }),
  });
  assert.equal(
    await sameCanonicalRows.count(),
    2,
    "Production assistance acceptance must not implicitly merge same-canonical lexical identities.",
  );

  console.log("ACCP006_PRODUCTION_SMOKE=PASS");
} finally {
  await context?.close();
  await rm(userDataDir, { recursive: true, force: true });
  await new Promise((resolveClose) => server.close(resolveClose));
}
