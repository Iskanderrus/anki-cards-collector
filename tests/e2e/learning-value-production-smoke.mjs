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
  "Production smoke must use the constrained production manifest.",
);
assert.ok(
  manifest.host_permissions.includes("http://127.0.0.1:8765/*"),
  "Production smoke uses only the existing local AnkiConnect fixture origin.",
);

const fixtureHtml = `<!doctype html>
<html>
  <head><title>ACCP-007 production smoke</title></head>
  <body>
    <main>
      <p id="first">Aunque llueva, voy a caminar por el parque esta tarde.</p>
      <p id="improve-first">policy evidence appears in a controlled sentence with enough surrounding words.</p>
      <p id="improve-strong">Before lunch the policy evidence appears in a controlled sentence with enough surrounding words today.</p>
      <p id="weak">weak chunk</p>
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

const userDataDir = await mkdtemp(join(tmpdir(), "collector-accp007-production-"));
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

async function capture(contentPage, panel, selector, phrase) {
  await ensureQueue(panel);
  await selectText(contentPage, selector, phrase);
  await contentPage.bringToFront();
  await clickPanelButton(panel, "Collect");
  return cardForTerm(panel, phrase);
}

async function screenshot(panel, name) {
  await mkdir("artifacts/accp007", { recursive: true });
  await panel.setViewportSize({ width: 640, height: 600 });
  await panel.screenshot({
    path: `artifacts/accp007/${name}.png`,
    fullPage: false,
  });
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

  // First useful evidence: recommendation only; Ready remains explicit.
  let card = await capture(contentPage, panel, "#first", "Aunque");
  assert.match(
    await card.locator(".learning-value").innerText(),
    /Learning value[\s\S]*Study[\s\S]*First useful evidence supports one review card/i,
  );
  assert.match(await card.locator(".card-head > .pill").innerText(), /inbox/i);
  assert.equal(await card.getByRole("button", { name: "Ready" }).isDisabled(), false);
  await screenshot(panel, "study");
  await card.getByRole("button", { name: "Ready" }).click();
  await card.locator(".card-head > .pill", { hasText: "ready" }).waitFor();

  // Equivalent repeat: retain corpus evidence and the one approved study identity.
  await ensureQueue(panel);
  await selectText(contentPage, "#first", "Aunque");
  await contentPage.bringToFront();
  await clickPanelButton(panel, "Collect");
  card = await cardForTerm(panel, "Aunque");
  assert.match(
    await card.locator(".learning-value").innerText(),
    /Evidence only[\s\S]*adds evidence, but the current study card is unchanged/i,
  );
  assert.match(await card.locator(".card-head > .pill").innerText(), /ready/i);
  assert.match(await card.getAttribute("aria-label"), /2 occurrences/);
  await screenshot(panel, "evidence-only");
  await ensureQueue(panel);
  assert.equal(
    await panel.locator(".queue-row").filter({
      has: panel.locator(".term", { hasText: /^Aunque$/ }),
    }).count(),
    1,
    "Equivalent evidence must retain one lexical/study identity.",
  );

  // Better selected evidence: stronger ACCP-002 context changes the proposal and requires re-review.
  card = await capture(contentPage, panel, "#improve-first", "policy evidence");
  assert.match(await card.locator(".learning-value").innerText(), /Study/i);
  await card.getByRole("button", { name: "Ready" }).click();
  await card.locator(".card-head > .pill", { hasText: "ready" }).waitFor();

  await ensureQueue(panel);
  await selectText(contentPage, "#improve-strong", "policy evidence");
  await contentPage.bringToFront();
  await clickPanelButton(panel, "Collect");
  card = await cardForTerm(panel, "policy evidence");
  assert.match(
    await card.locator(".learning-value").innerText(),
    /Improve[\s\S]*stronger selected context/i,
  );
  assert.match(await card.locator(".card-head > .pill").innerText(), /inbox/i);
  assert.equal(await card.getByRole("button", { name: "Ready" }).isDisabled(), false);
  await screenshot(panel, "improve");

  // Weak material: recommendation is Archive for now, but no automatic Archive occurs.
  card = await capture(contentPage, panel, "#weak", "weak chunk");
  assert.match(
    await card.locator(".learning-value").innerText(),
    /Archive for now[\s\S]*does not support a useful study card yet/i,
  );
  assert.match(await card.locator(".card-head > .pill").innerText(), /inbox/i);
  assert.equal(await card.getByRole("button", { name: "Ready" }).isDisabled(), true);
  assert.equal(await card.getByRole("button", { name: "Archive" }).isDisabled(), false);
  await screenshot(panel, "archive-for-now");

  const accessibility = await new AxeBuilder({ page: panel })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  assert.equal(
    accessibility.violations.length,
    0,
    "Production learning-value accessibility violations:\n"
      + JSON.stringify(accessibility.violations, null, 2),
  );

  console.log("ACCP007_PRODUCTION_SMOKE=PASS");
} finally {
  await context?.close();
  await rm(userDataDir, { recursive: true, force: true });
  await new Promise((resolveClose) => server.close(resolveClose));
}
