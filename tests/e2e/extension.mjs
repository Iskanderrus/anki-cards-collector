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
assert.equal(
  manifest.host_permissions.some((pattern) => /duolingo\.com/.test(pattern)),
  false,
  "Duolingo access must not be a required host permission.",
);
assert.ok(
  manifest.optional_host_permissions?.includes("https://duolingo.com/*"),
  "Apex Duolingo access must be optional.",
);
assert.ok(
  manifest.optional_host_permissions?.includes("https://*.duolingo.com/*"),
  "Duolingo subdomain access must be optional.",
);

const server = createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });

  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/duolingo") {
    const longHebrew = "טקסט ארוך מאוד ".repeat(24);
    response.end(`<!doctype html>
      <html data-collector-duolingo-fixture="true">
        <head><title>Duolingo Visible Review Fixture</title></head>
        <body>
          <nav>Home Shop Profile</nav>
          <main>
            <div id="challenge" data-test="challenge-translate">
              <p data-test="challenge-sentence" lang="he">שלום עולם</p>
              <p data-test="challenge-sentence">Hello there</p>
              <div lang="he">${longHebrew}</div>
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

  if (pathname === "/duolingo-pairs") {
    response.end(`<!doctype html>
      <html data-collector-duolingo-fixture="true">
        <head><title>Duolingo Matching Pairs Fixture</title></head>
        <body>
          <main>
            <div data-test="challenge-match">
              <div class="pair-column">
                <button lang="en">1<span>a fruit</span></button>
                <button lang="en">2<span>soup</span></button>
                <button lang="en">3<span>a lemon</span></button>
                <button lang="en">4<span>pasta</span></button>
                <button lang="en">5<span>sad</span></button>
              </div>
              <div class="pair-column">
                <button lang="he">6<span lang="he">מרק</span></button>
                <button lang="he">7<span lang="he">פרי</span></button>
                <button lang="he">8<span lang="he">עצוב</span></button>
                <button lang="he">9<span lang="he">לימון</span></button>
                <button lang="he">0<span lang="he">פסטה</span></button>
              </div>
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

async function stopExtensionServiceWorker(context, page, extensionId) {
  const cdp = await context.newCDPSession(page);
  try {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const workerTarget = targetInfos.find(
      (target) =>
        target.type === "service_worker"
        && target.url.startsWith(`chrome-extension://${extensionId}/`),
    );
    assert.ok(workerTarget, "Extension service-worker target must exist before termination.");

    const result = await cdp.send("Target.closeTarget", {
      targetId: workerTarget.targetId,
    });
    assert.equal(result.success, true, "Extension service worker should terminate via CDP.");
  } finally {
    await cdp.detach();
  }
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
  await panel.locator(".settings").evaluate((details) => {
    if (details instanceof HTMLDetailsElement) details.open = true;
  });
  const languageInput = panel.locator("label").filter({ hasText: "Language code" }).locator("input");
  await languageInput.fill("he");
  await panel.waitForFunction(async () => {
    const stored = await chrome.storage.local.get("collectorSettings");
    return stored.collectorSettings?.defaultLanguage === "he";
  });

  const duolingoPage = await context.newPage();
  await duolingoPage.goto(`${fixtureUrl}duolingo`);
  await duolingoPage.bringToFront();

  await clickPanelButton(panel, "Scan visible Duolingo");
  await panel.locator(".backfill-status", { hasText: "3 staged candidates" }).waitFor();
  await panel.locator(".staged-candidate-text", { hasText: "שלום עולם" }).waitFor();
  assert.equal(
    await panel.locator(".staged-candidate").count(),
    3,
    "Staged Duolingo evidence should be inspectable without entering the corpus.",
  );
  const initialStagedBatch = await panel.evaluate(
    async () => chrome.runtime.sendMessage({ type: "GET_STAGED_BATCH" }),
  );
  assert.equal(initialStagedBatch?.ok, true);
  assert.equal(
    initialStagedBatch.batch.candidates.some((candidate) => candidate.surfaceText === "Hello there"),
    false,
    "An undeclared source-language sentence must not be stamped as Hebrew evidence.",
  );
  assert.equal(
    initialStagedBatch.batch.candidates.some((candidate) => candidate.surfaceText.length > 240),
    false,
    "Long language-marked aggregate wrappers must not become lexical candidates.",
  );
  assert.equal(
    initialStagedBatch.batch.candidates.some((candidate) => candidate.surfaceText.startsWith("טקסט ארוך מאוד")),
    false,
    "A >240-character target-language wrapper must be rejected rather than truncated.",
  );
  assert.equal(
    await termCount(panel),
    2,
    "One-shot visible backfill must stage evidence without mutating the normal corpus.",
  );

  // MV3 service workers can terminate at any idle point. The staged batch must be
  // reconstructed from chrome.storage.session when the worker is woken again.
  await stopExtensionServiceWorker(context, panel, extensionId);
  await panel.waitForTimeout(100);

  const restoredAfterWorkerRestart = await panel.evaluate(
    async () => chrome.runtime.sendMessage({ type: "GET_STAGED_BATCH" }),
  );
  assert.equal(restoredAfterWorkerRestart?.ok, true);
  assert.equal(
    restoredAfterWorkerRestart?.batch?.candidates?.length,
    3,
    "Staged evidence must survive extension service-worker termination/restart.",
  );
  assert.equal(
    restoredAfterWorkerRestart.batch.candidates.some(
      (candidate) => candidate.surfaceText === "שלום עולם" && candidate.language === "he",
    ),
    true,
    "The staged Hebrew candidate must be reconstructed after worker restart.",
  );
  assert.equal(
    await termCount(panel),
    2,
    "Restoring transient staging must not insert staged evidence into the corpus.",
  );

  await clickPanelButton(panel, "Start backfill session");
  await panel.locator(".backfill-status", { hasText: "Backfill active" }).waitFor();

  const liveStatusBeforeWorkerRestart = await panel.evaluate(
    async () => chrome.runtime.sendMessage({ type: "DUOLINGO_GET_ACTIVE_SESSION_STATUS" }),
  );
  assert.equal(liveStatusBeforeWorkerRestart?.ok, true);
  assert.equal(liveStatusBeforeWorkerRestart?.status?.active, true);
  const liveSessionId = liveStatusBeforeWorkerRestart.status.sessionId;
  assert.equal(typeof liveSessionId, "string");

  // Live-session ownership must survive a worker restart even after another tab
  // becomes active. The restarted worker must validate and address the recorded
  // Duolingo owner tab rather than falling back to the current tab.
  await stopExtensionServiceWorker(context, panel, extensionId);
  await panel.waitForTimeout(100);
  await contentPage.bringToFront();

  const liveStatusAfterWorkerRestart = await panel.evaluate(
    async () => chrome.runtime.sendMessage({ type: "DUOLINGO_GET_ACTIVE_SESSION_STATUS" }),
  );
  assert.equal(liveStatusAfterWorkerRestart?.ok, true);
  assert.equal(liveStatusAfterWorkerRestart?.status?.active, true);
  assert.equal(
    liveStatusAfterWorkerRestart.status.sessionId,
    liveSessionId,
    "Worker restart must recover the original Duolingo session owner.",
  );

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

  await panel.waitForFunction(() => (
    document.querySelectorAll(".live-session-candidate").length === 6
  ));
  assert.equal(
    await panel.locator(".live-session-candidate").count(),
    6,
    "Active session preview should expose all accumulated evidence before staging.",
  );
  assert.equal(
    await panel.locator(".live-session-candidate .staged-candidate-text", { hasText: "אני לומד עברית" }).count(),
    1,
    "Newly rendered sentence evidence should appear in the live session preview.",
  );

  // Session evidence owns the language captured at session start. Changing the
  // current setting must not relabel already observed Hebrew evidence.
  await languageInput.fill("sr");
  await panel.waitForFunction(async () => {
    const stored = await chrome.storage.local.get("collectorSettings");
    return stored.collectorSettings?.defaultLanguage === "sr";
  });

  // Switch away from the originating tab before stopping. The service worker must
  // still address the Duolingo tab that owns the explicit session.
  await contentPage.bringToFront();

  const injectPersistenceFailure = await panel.evaluate(
    async () => chrome.runtime.sendMessage({ type: "E2E_FAIL_NEXT_STAGED_BATCH_PERSISTENCE" }),
  );
  assert.equal(injectPersistenceFailure?.ok, true);

  await clickPanelButton(panel, "Stop & stage session");
  await panel.locator(".notice.error", { hasText: "Injected staged-session persistence failure." }).waitFor();

  const statusAfterFailedExplicitStop = await panel.evaluate(
    async () => chrome.runtime.sendMessage({ type: "DUOLINGO_GET_ACTIVE_SESSION_STATUS" }),
  );
  assert.equal(statusAfterFailedExplicitStop?.ok, true);
  assert.equal(
    statusAfterFailedExplicitStop?.status?.active,
    true,
    "Failed staging persistence must leave the explicit-stop session reachable for retry.",
  );
  assert.equal(statusAfterFailedExplicitStop.status.sessionId, liveSessionId);
  assert.equal(
    statusAfterFailedExplicitStop.status.candidateCount,
    6,
    "Failed explicit Stop must retain the frozen six-candidate live buffer.",
  );

  await clickPanelButton(panel, "Stop & stage session");
  await panel.getByRole("button", { name: "Start backfill session" }).waitFor();
  await panel.locator(".backfill-status", { hasText: "staged candidate" }).waitFor();
  assert.equal(
    await panel.locator(".live-session-candidate").count(),
    0,
    "Live session preview should clear after Stop & stage.",
  );
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

  assert.equal(
    stagedBatch.batch.candidates.every(
      (candidate) => !/Write this in English|Home|Shop|Profile|Continue|doesn't|create|boys/.test(candidate.context),
    ),
    true,
    "Duolingo prompt text, answer choices, and UI chrome must not pollute candidate context.",
  );
  assert.equal(
    stagedBatch.batch.candidates
      .filter((candidate) => ["אני", "עברית"].includes(candidate.surfaceText))
      .every((candidate) => candidate.context === "אני לומד עברית"),
    true,
    "Word-bank tokens should inherit the nearest clean target-language sentence as context.",
  );
  assert.equal(
    stagedBatch.batch.candidates.every((candidate) => candidate.language === "he"),
    true,
    "Changing Settings mid-session must not relabel observed Hebrew evidence as Serbian.",
  );

  await languageInput.fill("he");
  await panel.waitForFunction(async () => {
    const stored = await chrome.storage.local.get("collectorSettings");
    return stored.collectorSettings?.defaultLanguage === "he";
  });

  // A same-document Duolingo SPA transition away from lesson/review content must
  // stop the active observer even though the hostname and document stay the same.
  await duolingoPage.bringToFront();
  await clickPanelButton(panel, "Start backfill session");
  await panel.locator(".backfill-status", { hasText: "Backfill active" }).waitFor();

  // Add evidence that exists only in this second session. If automatic
  // termination drops the live buffer, this candidate will disappear entirely.
  await duolingoPage.evaluate(() => {
    const challenge = document.querySelector("#challenge");
    if (!challenge) throw new Error("Duolingo E2E challenge fixture is missing.");
    challenge.innerHTML = `
      <p data-test="challenge-sentence" lang="he">ראיה אוטומטית חדשה</p>
      <button data-test="continue-button">Continue</button>
    `;
  });
  await panel.locator(".live-session-candidate .staged-candidate-text", {
    hasText: "ראיה אוטומטית חדשה",
  }).waitFor();

  await duolingoPage.evaluate(() => {
    history.pushState({}, "", "/home");
    const main = document.querySelector("main");
    if (!main) throw new Error("Duolingo E2E main fixture is missing.");
    main.innerHTML = `
      <section data-test="home-feed">
        <h1>Home</h1>
        <p lang="he">טקסט שאינו חלק משיעור</p>
      </section>
    `;
  });

  await panel.getByRole("button", { name: "Start backfill session" }).waitFor();
  assert.equal(
    await panel.locator(".live-session-candidate").count(),
    0,
    "SPA navigation away from supported study context must terminate the live session.",
  );
  await panel.locator(".notice", { hasText: "preserved" }).waitFor();

  const awayStatus = await panel.evaluate(
    async () => chrome.runtime.sendMessage({ type: "DUOLINGO_GET_ACTIVE_SESSION_STATUS" }),
  );
  assert.equal(awayStatus?.ok, true);
  assert.equal(awayStatus?.status?.active, false);
  assert.equal(awayStatus?.supported, false);

  await panel.waitForFunction(async () => {
    const response = await chrome.runtime.sendMessage({ type: "GET_STAGED_BATCH" });
    return response?.batch?.candidates?.some(
      (candidate) => candidate.surfaceText === "ראיה אוטומטית חדשה",
    ) === true;
  });
  const autoStagedBatch = await panel.evaluate(
    async () => chrome.runtime.sendMessage({ type: "GET_STAGED_BATCH" }),
  );
  assert.equal(autoStagedBatch?.ok, true);
  assert.equal(
    autoStagedBatch.batch.candidates.some(
      (candidate) =>
        candidate.surfaceText === "ראיה אוטומטית חדשה"
        && candidate.language === "he",
    ),
    true,
    "Evidence unique to an auto-terminated session must survive in ACCP-019 staging.",
  );
  assert.equal(
    autoStagedBatch.batch.candidates.length,
    7,
    "Automatic session termination should add only the new unique session evidence.",
  );

  // Matching-pairs challenges often put keyboard shortcut numbers in an outer
  // language-marked wrapper. Only the clean leaf target text should be staged.
  const pairsPage = await context.newPage();
  await pairsPage.goto(`${fixtureUrl}duolingo-pairs`);
  await pairsPage.bringToFront();
  await panel.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim() === "Scan visible Duolingo");
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  const pairScanResult = await panel.evaluate(
    async () => chrome.runtime.sendMessage({ type: "DUOLINGO_SCAN_ACTIVE" }),
  );
  assert.equal(pairScanResult?.ok, true, pairScanResult?.error);
  assert.equal(
    pairScanResult?.foundCount,
    5,
    `Matching-pairs extractor should return five Hebrew leaves, got ${JSON.stringify(pairScanResult)}`,
  );

  const pairsBatch = await panel.evaluate(
    async () => chrome.runtime.sendMessage({ type: "GET_STAGED_BATCH" }),
  );
  assert.equal(pairsBatch?.ok, true);
  assert.equal(pairsBatch?.batch?.candidates?.length, 12);

  const pairTexts = pairsBatch.batch.candidates
    .map((candidate) => candidate.surfaceText)
    .filter((text) => ["מרק", "פרי", "עצוב", "לימון", "פסטה"].includes(text));
  assert.deepEqual(
    [...pairTexts].sort(),
    ["מרק", "פרי", "עצוב", "לימון", "פסטה"].sort(),
    "Each Hebrew matching-pair term should be staged exactly once.",
  );
  assert.equal(
    pairsBatch.batch.candidates.some((candidate) => /\d/.test(candidate.surfaceText)),
    false,
    "Keyboard shortcut digits from matching-pair wrappers must not enter lexical candidates.",
  );
  assert.equal(
    pairsBatch.batch.candidates
      .filter((candidate) => ["מרק", "פרי", "עצוב", "לימון", "פסטה"].includes(candidate.surfaceText))
      .every((candidate) => candidate.context === candidate.surfaceText),
    true,
    "Isolated matching-pair vocabulary should keep itself as clean context.",
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
