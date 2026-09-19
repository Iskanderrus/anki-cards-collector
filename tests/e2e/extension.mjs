import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const extensionPath = resolve("dist");
const manifest = JSON.parse(await readFile(join(extensionPath, "manifest.json"), "utf8"));

assert.equal(manifest.content_scripts, undefined, "E2E manifest must not add persistent content scripts.");
assert.ok(manifest.permissions.includes("activeTab"));
assert.ok(manifest.permissions.includes("scripting"));

const server = createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });

  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/duolingo") {
    response.end(`<!doctype html>
      <html data-collector-duolingo-fixture="true">
        <head><title>Duolingo Visible Review Fixture</title></head>
        <body>
          <nav>Home Shop Profile</nav>
          <main>
            <div id="challenge" data-test="challenge-translate">
              <p data-test="challenge-sentence" lang="he">שלום עולם</p>
              <div data-test="word-bank">
                <button data-test="challenge-tap-token" lang="he">שלום</button>
                <button data-test="challenge-tap-token" lang="he">עולם</button>
              </div>
              <button data-test="continue-button">Continue</button>
            </div>
          </main>
        </body>
      </html>`);
    return;
  }

  response.end(`<!doctype html>
    <html>
      <head><title>Collector E2E Fixture</title></head>
      <body>
        <main>
          <p id="first">Aunque llueva, voy a caminar porque quiero practicar español.</p>
          <p id="second">Context menu phrase appears in a separate sentence for capture.</p>
          <p id="repeat">Aunque llueva.</p>
        </main>
      </body>
    </html>`);
});

await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(0, "127.0.0.1", resolveListen);
});

const address = server.address();
if (!address || typeof address === "string") throw new Error("Could not start E2E HTTP fixture.");
const fixtureUrl = `http://127.0.0.1:${address.port}/`;

const userDataDir = await mkdtemp(join(tmpdir(), "collector-e2e-"));
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

async function termCount(panel) {
  return panel.locator(".term").count();
}

async function cardForTerm(panel, term) {
  return panel.locator(".card").filter({ has: panel.locator(".term", { hasText: term }) });
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
  await contentPage.goto(fixtureUrl);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.locator("h1").waitFor();
  assert.equal(await termCount(panel), 0);

  // Explicit selection capture through the same runtime message used by the side-panel button.
  await selectText(contentPage, "#first", "Aunque llueva");
  await contentPage.bringToFront();
  await clickPanelButton(panel, "Collect selection");

  await panel.locator(".term", { hasText: "Aunque llueva" }).waitFor();
  assert.equal(await termCount(panel), 1, "Explicit capture should add one lexical unit.");
  assert.match(
    await panel.locator(".context").first().innerText(),
    /Aunque llueva, voy a caminar/,
    "Captured item should keep visible page context.",
  );

  // The side panel must refresh via DATA_CHANGED; no page reload happens above.
  assert.equal(
    await panel.locator(".summary").innerText().then((value) => value.includes("1 unique total")),
    true,
    "Side panel should refresh after background capture.",
  );

  // Empty selection should fail usefully and must not write another item.
  await contentPage.evaluate(() => window.getSelection()?.removeAllRanges());
  await contentPage.bringToFront();
  await clickPanelButton(panel, "Collect selection");
  await panel.locator(".notice.error").filter({ hasText: "Select a word, phrase, or sentence first." }).waitFor();
  assert.equal(await panel.locator(".notice.error").getAttribute("role"), "alert");
  assert.equal(await termCount(panel), 1, "Empty selection must not add data.");

  // Chromium's native context-menu UI is not stable to automate. The E2E-only hook below
  // invokes the exact same captureFromContextMenu handler registered with onClicked.
  await selectText(contentPage, "#second", "Context menu phrase");
  await contentPage.bringToFront();
  const tabId = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  });
  assert.equal(typeof tabId, "number");

  const contextMenuResult = await panel.evaluate(
    async (activeTabId) => chrome.runtime.sendMessage({
      type: "E2E_CONTEXT_MENU_CLICK",
      tabId: activeTabId,
    }),
    tabId,
  );
  assert.equal(contextMenuResult?.ok, true, contextMenuResult?.error);
  await panel.locator(".term", { hasText: "Context menu phrase" }).waitFor();
  assert.equal(await termCount(panel), 2, "Context-menu handler should add a second lexical unit.");

  // Keyboard review: the first captured item remains active even though the newer item sorts above it.
  await panel.bringToFront();
  const firstCard = await cardForTerm(panel, "Aunque llueva");
  await firstCard.focus();
  assert.equal(await firstCard.getAttribute("data-active"), "true");

  await panel.keyboard.press("k");
  const secondCard = await cardForTerm(panel, "Context menu phrase");
  await secondCard.waitFor();
  assert.equal(await secondCard.getAttribute("data-active"), "true", "K should move to the previous visible card.");

  await panel.keyboard.press("r");
  await secondCard.locator(".pill", { hasText: "ready" }).waitFor();

  await panel.keyboard.press("e");
  await secondCard.locator(".editor").waitFor();
  const noteField = secondCard.locator("textarea").last();
  await noteField.focus();
  await panel.keyboard.press("a");
  assert.equal(
    await secondCard.locator(".pill").innerText(),
    "ready",
    "Typing inside an editor must not trigger the Archive shortcut.",
  );
  await secondCard.getByRole("button", { name: "Cancel" }).click();

  await secondCard.focus();
  await panel.keyboard.press("ArrowDown");
  assert.equal(
    await firstCard.getAttribute("data-active"),
    "true",
    "ArrowDown should move to the next visible card.",
  );

  // Repeated evidence must enrich the existing lexical unit, not create another study target.
  // The newer occurrence is deliberately weak so the older, stronger context should remain selected.
  await selectText(contentPage, "#repeat", "Aunque llueva");
  await contentPage.bringToFront();
  await clickPanelButton(panel, "Collect selection");
  await firstCard.locator(".meta", { hasText: "2 occurrences" }).waitFor();
  assert.equal(await termCount(panel), 2, "Repeated capture must not create a duplicate lexical unit.");
  assert.match(
    await firstCard.locator(".context").innerText(),
    /Aunque llueva, voy a caminar porque quiero practicar español\./,
    "The older stronger occurrence should remain the reviewed context.",
  );
  assert.match(
    await firstCard.locator(".occurrence-selection").innerText(),
    /Using occurrence 1 of 2/,
    "Review should explain which occurrence drives the proposal.",
  );

  // Duolingo visible backfill is explicitly activated and remains staged.
  const duolingoPage = await context.newPage();
  await duolingoPage.goto(`${fixtureUrl}duolingo`);
  await duolingoPage.bringToFront();

  await clickPanelButton(panel, "Scan visible Duolingo");
  await panel.locator(".backfill-status", { hasText: "3 staged candidates" }).waitFor();
  assert.equal(
    await termCount(panel),
    2,
    "One-shot visible backfill must stage evidence without mutating the normal corpus.",
  );

  await clickPanelButton(panel, "Start backfill session");
  await panel.locator(".backfill-status", { hasText: "Backfill active" }).waitFor();

  await duolingoPage.evaluate(() => {
    const challenge = document.querySelector("#challenge");
    if (!challenge) throw new Error("Duolingo E2E challenge fixture is missing.");
    challenge.innerHTML = `
      <p data-test="challenge-sentence" lang="he">אני לומד עברית</p>
      <div data-test="word-bank">
        <button data-test="challenge-tap-token" lang="he">אני</button>
        <button data-test="challenge-tap-token" lang="he">עברית</button>
      </div>
      <button data-test="continue-button">Continue</button>
    `;
  });

  // Switch away from the originating tab before stopping. The service worker must
  // still address the Duolingo tab that owns the explicit session.
  await contentPage.bringToFront();
  await clickPanelButton(panel, "Stop & stage session");
  await panel.getByRole("button", { name: "Start backfill session" }).waitFor();
  await panel.locator(".backfill-status", { hasText: "staged candidate" }).waitFor();
  assert.equal(
    await termCount(panel),
    2,
    "Stopping a Duolingo session must stage evidence without creating study items.",
  );

  const stagedBatch = await panel.evaluate(
    async () => chrome.runtime.sendMessage({ type: "GET_STAGED_BATCH" }),
  );
  assert.equal(stagedBatch?.ok, true);
  assert.equal(stagedBatch?.batch?.candidates?.length, 6);
  assert.equal(
    stagedBatch.batch.candidates.every(
      (candidate) =>
        candidate.source?.adapter === "duolingo-visible-backfill"
        && candidate.source?.kind === "duolingo",
    ),
    true,
    "Staged candidates must preserve Duolingo visible-DOM provenance.",
  );
  assert.equal(
    stagedBatch.batch.candidates.some((candidate) => /Home|Shop|Profile|Continue/.test(candidate.surfaceText)),
    false,
    "Navigation and generic UI chrome must not become backfill candidates.",
  );

  const accessibility = await new AxeBuilder({ page: panel })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  assert.equal(
    accessibility.violations.length,
    0,
    `Accessibility violations:\n${JSON.stringify(accessibility.violations, null, 2)}`,
  );

  // Produce a store-listing screenshot from the same synthetic corpus used by the E2E checks.
  // Reloading clears transient error/notice UI while keeping IndexedDB state.
  await panel.reload();
  await panel.locator(".term", { hasText: "Aunque llueva" }).waitFor();
  await panel.locator(".term", { hasText: "Context menu phrase" }).waitFor();
  await panel.setViewportSize({ width: 640, height: 400 });
  await mkdir("artifacts/store", { recursive: true });
  await panel.screenshot({
    path: "artifacts/store/screenshot-1.png",
    fullPage: false,
  });

  // Restricted browser pages cannot be scripted. The user gets a visible error and no data write.
  const restrictedPage = await context.newPage();
  await restrictedPage.goto("chrome://version/");
  await restrictedPage.bringToFront();
  await clickPanelButton(panel, "Collect selection");

  await panel.waitForFunction(() => {
    const node = document.querySelector(".notice.error");
    return Boolean(node?.textContent?.trim());
  });
  const restrictedError = await panel.locator(".notice.error").innerText();
  assert.match(
    restrictedError,
    /(cannot access|chrome:\/\/|restricted|permission|cannot be scripted|extensions gallery)/i,
    `Unexpected restricted-page error: ${restrictedError}`,
  );
  assert.equal(await termCount(panel), 2, "Restricted-page failure must not add data.");

  console.log("Browser extension capture, keyboard, accessibility, and permission checks passed.");
} finally {
  await context?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(userDataDir, { recursive: true, force: true });
}
