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

const ankiRequests = [];
let nextAnkiNoteId = 9000;
let ankiAvailable = true;
const ankiNotes = new Map();

function collectorIdentityTagForE2e(id) {
  let encoded = "";
  for (let index = 0; index < id.length; index += 1) {
    encoded += id.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return "collector::id::" + encoded;
}
const ankiDecks = new Map([
  ["Hebrew RU", 2],
  ["Serbian RU", 3],
]);
const ankiModels = new Map([
  ["Collector Basic", 10],
  ["Hebrew Existing", 11],
  ["Hebrew Verbs", 12],
  ["Serbian Existing", 13],
]);
const ankiModelFields = new Map([
  ["Hebrew Existing", ["Hebrew", "Russian", "Example"]],
  ["Hebrew Verbs", ["Hebrew", "Russian"]],
  ["Serbian Existing", ["Serbian", "Russian", "Example"]],
]);

const collectorFields = [
  "CollectorID",
  "Prompt",
  "Answer",
  "CardKind",
  "Why",
  "Canonical",
  "Observed",
  "Expression",
  "Context",
  "Note",
  "Source",
];

const ankiServer = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  ankiRequests.push(body);

  const action = body.action;
  const params = body.params ?? {};
  let result = null;
  let error = null;

  switch (action) {
    case "version":
      if (ankiAvailable) result = 6;
      else error = "Anki unavailable fixture";
      break;
    case "deckNamesAndIds":
      result = Object.fromEntries(ankiDecks);
      break;
    case "modelNamesAndIds":
      result = Object.fromEntries(ankiModels);
      break;
    case "modelFieldNames":
      result = params.modelName === "Collector Basic"
        ? collectorFields
        : ankiModelFields.get(params.modelName) ?? [];
      break;
    case "modelFieldsOnTemplates": {
      if (params.modelName === "Collector Basic") {
        result = { Recognition: [["Prompt"], ["Prompt", "Answer", "Context", "Note"]] };
      } else {
        const fields = ankiModelFields.get(params.modelName) ?? [];
        result = { Recognition: [[fields[0]].filter(Boolean), [fields[0], fields[1]].filter(Boolean)] };
      }
      break;
    }
    case "modelTemplates": {
      if (params.modelName === "Collector Basic") {
        result = {
          Recognition: {
            Front: "{{Prompt}}",
            Back: "{{FrontSide}}<hr id=answer><div class=answer>{{Answer}}</div><div class=context>{{Context}}</div><div class=context>{{Note}}</div><div class=meta>{{CardKind}} · {{Why}}</div><div class=context>{{Source}}</div>",
          },
        };
      } else {
        const fields = ankiModelFields.get(params.modelName) ?? [];
        result = {
          Recognition: {
            Front: "{{" + (fields[0] ?? "Front") + "}}",
            Back: "{{FrontSide}}<hr>{{" + (fields[1] ?? "Back") + "}}",
          },
        };
      }
      break;
    }
    case "modelStyling":
      result = { css: ".card { font-size: 22px; }" };
      break;
    case "deckNames":
      result = [...ankiDecks.keys()];
      break;
    case "modelNames":
      result = [...ankiModels.keys()];
      break;
    case "notesInfo":
      result = (params.notes ?? []).map((noteId) => {
        const note = ankiNotes.get(noteId);
        return note ? { noteId, modelName: note.modelName } : { noteId };
      });
      break;
    case "findNotes":
      result = [];
      break;
    case "canAddNotes":
      result = (params.notes ?? []).map(() => true);
      break;
    case "addNote":
      nextAnkiNoteId += 1;
      ankiNotes.set(nextAnkiNoteId, structuredClone(params.note));
      result = nextAnkiNoteId;
      break;
    case "createDeck": {
      const deckName = String(params.deck ?? "");
      if (!ankiDecks.has(deckName)) {
        const nextDeckId = Math.max(0, ...ankiDecks.values()) + 1;
        ankiDecks.set(deckName, nextDeckId);
      }
      result = ankiDecks.get(deckName);
      break;
    }
    case "updateNoteFields": {
      const note = ankiNotes.get(params.note?.id);
      if (note) {
        note.fields = { ...note.fields, ...params.note.fields };
        ankiNotes.set(params.note.id, note);
      }
      result = null;
      break;
    }
    case "addTags":
    case "modelFieldAdd":
    case "updateModelTemplates":
    case "updateModelStyling":
    case "changeDeck":
      result = null;
      break;
    case "findCards":
      if (params.query === 'deck:"Hebrew RU"') {
        result = [8006, 8001, 8005, 8002, 8004, 8003];
      } else if (params.query === 'deck:"Serbian RU"') {
        result = [8101, 8102];
      } else {
        result = [7001];
      }
      break;
    case "cardsInfo": {
      const fixtures = {
        8001: {
          cardId: 8001,
          deckName: "Hebrew RU",
          modelName: "Hebrew Existing",
          ord: 0,
          question: "<script>window.__unsafePreview = true</script><img src=https://tracking.invalid/pixel.png><a href=https://tracking.invalid/click>שלום</a>",
          answer: "<div class=back>hello</div>",
          css: ".front { font-size: 24px; } .back { font-size: 18px; }",
          fields: {},
        },
        8002: {
          cardId: 8002,
          deckName: "Hebrew RU",
          modelName: "Hebrew Existing",
          ord: 0,
          question: "<div class=front>בית</div>",
          answer: "<div class=back>house</div>",
          css: ".front { font-size: 24px; } .back { font-size: 18px; }",
          fields: {},
        },
        8003: {
          cardId: 8003,
          deckName: "Hebrew RU",
          modelName: "Hebrew Existing",
          ord: 1,
          question: "<div class=front>water</div>",
          answer: "<div class=back>מים</div>",
          css: ".front { font-size: 24px; } .back { font-size: 18px; }",
          fields: {},
        },
        8004: {
          cardId: 8004,
          deckName: "Hebrew RU",
          modelName: "Hebrew Existing",
          ord: 1,
          question: "<div class=front>book</div>",
          answer: "<div class=back>ספר</div>",
          css: ".front { font-size: 24px; } .back { font-size: 18px; }",
          fields: {},
        },
        8005: {
          cardId: 8005,
          deckName: "Hebrew RU",
          modelName: "Collector Basic",
          ord: 0,
          question: "<div>collector front</div>",
          answer: "<div>collector back</div>",
          css: ".card { font-family: sans-serif; }",
          fields: {},
        },
        8006: {
          cardId: 8006,
          deckName: "Hebrew RU",
          modelName: "Hebrew Verbs",
          ord: 0,
          question: "<div>כותב</div>",
          answer: "<div>writes</div>",
          css: ".card { font-size: 20px; }",
          fields: {},
        },
        8101: {
          cardId: 8101,
          deckName: "Serbian RU",
          modelName: "Collector Basic",
          ord: 0,
          question: "<div>dobar dan</div>",
          answer: "<div>добрый день</div>",
          css: ".card { font-size: 20px; }",
          fields: {},
        },
        8102: {
          cardId: 8102,
          deckName: "Serbian RU",
          modelName: "Serbian Existing",
          ord: 0,
          question: "<div class=front>kuća</div>",
          answer: "<div class=back>дом</div>",
          css: ".front { font-size: 23px; } .back { font-size: 18px; }",
          fields: {},
        },
      };
      result = (params.cards ?? [])
        .map((cardId) => fixtures[cardId])
        .filter(Boolean);
      break;
    }
    default:
      error = `Unexpected AnkiConnect action in E2E fixture: ${action}`;
  }

  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(JSON.stringify({ result, error }));
});

await new Promise((resolveListen, rejectListen) => {
  ankiServer.once("error", rejectListen);
  ankiServer.listen(8765, "127.0.0.1", resolveListen);
});

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
          <p id="long">Esta frase deliberadamente larga contiene muchas palabras útiles para comprobar que una fila compacta sigue siendo fácil de escanear.</p>
          <p id="canonical-base">Quiero tener tiempo para estudiar.</p>
          <p id="canonical-observed">Tengo tiempo para estudiar hoy.</p>
          <p id="mapped">Mapped export phrase demonstrates an existing Anki note type.</p>
          <p id="mapped-context">Mapped context-menu phrase demonstrates profile-driven capture language.</p>
          <p id="mapped-sr">Serbian mapped export phrase demonstrates a second existing Anki note type.</p>
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

async function ensureQueue(panel) {
  if (await panel.locator(".queue").count() === 0) {
    await panel.getByRole("button", { name: "Queue", exact: true }).click();
  }
  await panel.locator(".queue").waitFor();
}

async function openSettings(panel) {
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel.locator(".settings").waitFor();
}

async function setCaptureLanguage(panel, language) {
  await openSettings(panel);
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

async function termCount(panel) {
  await ensureQueue(panel);
  return panel.locator(".queue-row .term").count();
}

async function queueRowForTerm(panel, term) {
  await ensureQueue(panel);
  return panel.locator(".queue-row").filter({
    has: panel.locator(".term", { hasText: term }),
  });
}

async function cardForTerm(panel, term) {
  const row = await queueRowForTerm(panel, term);
  await row.click();
  const card = panel.locator(".detail-card").filter({
    has: panel.locator(".term", { hasText: term }),
  });
  await card.waitFor();
  return card;
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

  await panel.locator(".queue-row .term", { hasText: "Aunque llueva" }).waitFor();
  assert.equal(await termCount(panel), 1, "Explicit capture should add one lexical unit.");
  const firstQueueRowAfterCapture = await queueRowForTerm(panel, "Aunque llueva");
  assert.match(
    await firstQueueRowAfterCapture.locator(".queue-context").innerText(),
    /Aunque llueva, voy a caminar/,
    "Compact queue should retain a short preview of the selected visible context.",
  );
  assert.equal(
    await panel.locator(".learning-proposal").count(),
    0,
    "Queue view must not render full proposal detail for every item.",
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
  await panel.locator(".queue-row .term", { hasText: "Context menu phrase" }).waitFor();
  assert.equal(await termCount(panel), 2, "Context-menu handler should add a second lexical unit.");

  // Keyboard review: the first captured item remains active even though the newer item sorts above it.
  await panel.bringToFront();
  const firstRow = await queueRowForTerm(panel, "Aunque llueva");
  await firstRow.focus();
  assert.equal(await firstRow.getAttribute("data-active"), "true");

  await panel.keyboard.press("k");
  const secondRow = await queueRowForTerm(panel, "Context menu phrase");
  assert.equal(await secondRow.getAttribute("data-active"), "true", "K should move to the previous visible row.");

  await panel.keyboard.press("r");
  await secondRow.locator(".pill", { hasText: "ready" }).waitFor();

  await panel.keyboard.press("e");
  const secondCard = panel.locator(".detail-card").filter({
    has: panel.locator(".term", { hasText: "Context menu phrase" }),
  });
  await secondCard.locator(".editor").waitFor();
  const noteField = secondCard.locator("textarea").last();
  await noteField.focus();
  await panel.keyboard.press("a");
  assert.equal(
    await secondCard.locator(".card-head > .pill").innerText(),
    "ready",
    "Typing inside an editor must not trigger the Archive shortcut.",
  );
  await secondCard.getByRole("button", { name: "Cancel" }).click();

  await secondCard.focus();
  await panel.keyboard.press("b");
  await firstRow.waitFor();
  await secondRow.focus();
  await panel.keyboard.press("ArrowDown");
  assert.equal(
    await firstRow.getAttribute("data-active"),
    "true",
    "ArrowDown should move to the next visible row.",
  );

  // Repeated evidence must enrich the existing lexical unit, not create another study target.
  // The newer occurrence is deliberately weak so the older, stronger context should remain selected.
  await selectText(contentPage, "#repeat", "Aunque llueva");
  await contentPage.bringToFront();
  await clickPanelButton(panel, "Collect selection");
  assert.equal(await termCount(panel), 2, "Repeated capture must not create a duplicate lexical unit.");
  const firstCard = await cardForTerm(panel, "Aunque llueva");
  await firstCard.locator(".meta", { hasText: "2 occurrences" }).waitFor();
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
  const observedEvidence = firstCard.locator(".canonical-evidence");
  await observedEvidence.getByText("Canonical form").waitFor();
  await observedEvidence.getByText("Observed forms (1)", { exact: true }).waitFor();
  assert.match(
    await observedEvidence.innerText(),
    /Observed forms \(1\)/,
    "Focused detail should group repeated observed evidence instead of duplicating full cards.",
  );
  assert.match(
    await observedEvidence.innerText(),
    /2×/,
    "Observed-form groups should expose occurrence counts.",
  );

  await firstCard.getByRole("button", { name: "Edit" }).click();
  await firstCard.locator(".editor").getByLabel("Canonical form").fill("aunque llueva siempre");
  const renamePreview = firstCard.locator(".canonicalization-preview.rename");
  await renamePreview.waitFor();
  assert.match(
    await renamePreview.innerText(),
    /Rename .*Aunque llueva.*aunque llueva siempre/s,
    "Canonical edits should preview a rename before saving.",
  );
  await firstCard.getByRole("button", { name: "Cancel" }).click();

  // Duolingo visible backfill is explicitly activated and remains staged.
  await setCaptureLanguage(panel, "he");

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
  await setCaptureLanguage(panel, "sr");

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

  await setCaptureLanguage(panel, "he");

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

  // ACCP-013 browser acceptance: the user-facing workflow is language -> deck.
  // Internal export profiles remain an implementation detail.
  await panel.bringToFront();
  await openSettings(panel);
  await clickPanelButton(panel, "Refresh from Anki");
  await panel.locator(".anki-catalog-status", { hasText: "Connected" }).waitFor();

  // Collector Inbox is intentionally absent from the fake live catalog. It must
  // only be created after the user presses the explicit button.
  const fallbackRow = panel.locator(".fallback-deck-row");
  const createDeckButton = fallbackRow.getByRole("button", { name: "Create deck" });
  await createDeckButton.waitFor();
  assert.equal(ankiDecks.has("Collector Inbox"), false);
  const createRequestsBefore = ankiRequests.filter(
    (request) => request.action === "createDeck",
  ).length;
  await createDeckButton.click();
  await createDeckButton.waitFor({ state: "detached" });
  assert.equal(ankiDecks.has("Collector Inbox"), true);
  assert.equal(
    ankiRequests.filter((request) => request.action === "createDeck").length,
    createRequestsBefore + 1,
    "A missing saved deck must be created only through the explicit UI action.",
  );

  const addLanguage = panel.locator(".language-deck-add");
  const newLanguage = addLanguage.getByLabel("New language code");
  const newLanguageDeck = addLanguage.getByLabel("Anki deck for new language");

  await newLanguage.fill("he");
  await newLanguageDeck.selectOption({ label: "Hebrew RU" });
  await clickPanelButton(panel, "Add language");
  const hebrewRoute = panel.locator('.language-deck-row[data-language="he"]');
  await hebrewRoute.waitFor();
  assert.equal(
    await hebrewRoute.getByLabel("Anki deck for he").inputValue(),
    "Hebrew RU",
  );

  await newLanguage.fill("sr");
  await newLanguageDeck.selectOption({ label: "Serbian RU" });
  await clickPanelButton(panel, "Add language");
  const serbianRoute = panel.locator('.language-deck-row[data-language="sr"]');
  await serbianRoute.waitFor();
  assert.equal(
    await serbianRoute.getByLabel("Anki deck for sr").inputValue(),
    "Serbian RU",
  );

  // ACCP-017: inspecting a configured deck is bounded, read-only evidence.
  const mutations = new Set([
    "addNote",
    "changeDeck",
    "createDeck",
    "createModel",
    "modelFieldAdd",
    "updateModelTemplates",
    "updateModelStyling",
    "updateNoteFields",
  ]);
  const requestsBeforeDeckAnalysis = ankiRequests.length;
  await hebrewRoute.getByRole("button", { name: "Inspect" }).click();

  const analysisPanel = panel.locator(".deck-analysis");
  await analysisPanel.getByText("Existing cards in Hebrew RU").waitFor();
  await analysisPanel.getByText("Inspected 6 of 6 sampled cards from 6 total.").waitFor();

  const modelSamples = analysisPanel.locator(".deck-model-sample");
  assert.equal(await modelSamples.count(), 3);
  await analysisPanel.getByText("Hebrew Existing").waitFor();
  await analysisPanel.getByText("4/6 inspected").waitFor();
  await analysisPanel.getByText("Hebrew Verbs").waitFor();
  await analysisPanel.getByText("1/6 inspected").first().waitFor();
  await analysisPanel.getByText("Collector Basic").waitFor();

  const hebrewModel = analysisPanel.locator(".deck-model-sample", {
    hasText: "Hebrew Existing",
  });
  await hebrewModel.evaluate((details) => {
    if (details instanceof HTMLDetailsElement) details.open = true;
  });
  assert.equal(
    await hebrewModel.locator(".representative-card").count(),
    2,
    "Two sampled template ordinals should produce two representatives.",
  );

  const firstRepresentativeFront = hebrewModel
    .locator('iframe[title="Hebrew Existing representative front"]')
    .first();
  await firstRepresentativeFront.waitFor();
  const representativeFrame = firstRepresentativeFront.contentFrame();
  assert.match(
    await representativeFrame.locator("body").innerText(),
    /שלום/,
    "Representative front should use rendered cardsInfo content.",
  );
  assert.equal(
    await representativeFrame.locator("script").count(),
    0,
    "Representative preview must strip script elements.",
  );
  assert.equal(
    await representativeFrame.locator("img[src]").count(),
    0,
    "Representative preview must remove external image URLs.",
  );
  assert.equal(
    await representativeFrame.locator("a[href]").count(),
    0,
    "Representative preview must remove external navigation URLs.",
  );

  const analysisRequests = ankiRequests.slice(requestsBeforeDeckAnalysis);
  assert.deepEqual(
    analysisRequests.map((request) => request.action),
    ["findCards", "cardsInfo"],
    "Deck analysis should use only its bounded read-only AnkiConnect actions.",
  );
  assert.equal(
    analysisRequests.some((request) => mutations.has(request.action)),
    false,
    "Inspecting a deck must not mutate Anki.",
  );

  assert.equal(
    await analysisPanel.locator(".anki-preview-frame").evaluateAll((frames) =>
      frames.every((frame) => frame instanceof HTMLIFrameElement && Boolean(frame.title))
    ),
    true,
    "Every sandboxed representative preview must have an accessible title.",
  );

  await analysisPanel.getByRole("button", { name: "Close" }).click();
  await analysisPanel.waitFor({ state: "detached" });

  let firstRoutingCard = await cardForTerm(panel, "Aunque llueva");
  await firstRoutingCard.getByRole("button", { name: "Edit" }).click();
  await firstRoutingCard.locator(".editor").getByLabel("Language code").fill("he");
  await firstRoutingCard.getByRole("button", { name: "Save" }).click();
  await firstRoutingCard.locator(".editor").waitFor({ state: "detached" });
  const firstReady = firstRoutingCard.getByRole("button", { name: "Ready" });
  if (await firstReady.count()) await firstReady.click();
  await firstRoutingCard.locator(".pill", { hasText: "ready" }).waitFor();
  assert.match(
    await firstRoutingCard.locator(".export-destination").innerText(),
    /Anki:\s*Hebrew RU/,
    "The Hebrew card should show only its resolved Anki deck.",
  );

  let secondRoutingCard = await cardForTerm(panel, "Context menu phrase");
  await secondRoutingCard.getByRole("button", { name: "Edit" }).click();
  await secondRoutingCard.locator(".editor").getByLabel("Language code").fill("sr");
  await secondRoutingCard.getByRole("button", { name: "Save" }).click();
  await secondRoutingCard.locator(".editor").waitFor({ state: "detached" });
  const secondReady = secondRoutingCard.getByRole("button", { name: "Ready" });
  if (await secondReady.count()) await secondReady.click();
  await secondRoutingCard.locator(".pill", { hasText: "ready" }).waitFor();
  assert.match(
    await secondRoutingCard.locator(".export-destination").innerText(),
    /Anki:\s*Serbian RU/,
    "The Serbian card should show only its resolved Anki deck.",
  );

  ankiRequests.length = 0;
  await clickPanelButton(panel, "Send ready to Anki");
  await panel.locator(".notice", { hasText: "2 exported" }).waitFor();

  const addNotes = ankiRequests.filter((request) => request.action === "addNote");
  assert.equal(addNotes.length, 2, "Mixed Ready batch should create two routed Anki notes.");
  const deckByCanonical = Object.fromEntries(
    addNotes.map((request) => [
      request.params.note.fields.Canonical,
      request.params.note.deckName,
    ]),
  );
  assert.equal(deckByCanonical["Aunque llueva"], "Hebrew RU");
  assert.equal(deckByCanonical["Context menu phrase"], "Serbian RU");

  firstRoutingCard = await cardForTerm(panel, "Aunque llueva");
  assert.match(
    await firstRoutingCard.locator(".export-destination").innerText(),
    /Anki:\s*Hebrew RU.*note\s+\d+/s,
  );
  secondRoutingCard = await cardForTerm(panel, "Context menu phrase");
  assert.match(
    await secondRoutingCard.locator(".export-destination").innerText(),
    /Anki:\s*Serbian RU.*note\s+\d+/s,
  );

  // ACCP-018: configure the mapped Hebrew profile through the guided UI.
  await panel.bringToFront();
  await openSettings(panel);
  await clickPanelButton(panel, "Refresh from Anki");
  await panel.locator(".anki-catalog-status", { hasText: "Connected" }).waitFor();

  const guidedProfiles = panel.locator(".guided-profiles");
  await guidedProfiles.getByRole("button", { name: "New profile" }).click();
  const guidedForm = guidedProfiles.locator(".guided-profile-form");
  await guidedForm.getByLabel("Profile language").selectOption("he");
  await guidedForm.getByLabel("Live Anki deck").selectOption({ label: "Hebrew RU" });
  await guidedForm.getByText(/Sample evidence only:/).waitFor();

  const intendedModel = guidedForm.getByLabel("Intended note type");
  assert.equal(await intendedModel.inputValue(), "", "Mixed-note-type evidence must not auto-select a target model.");
  assert.equal(
    await intendedModel.locator('option[value="Collector Basic"]').count(),
    0,
    "Collector-managed models must stay on the managed routing path, not be mislabeled as user-owned mappings.",
  );
  assert.match(
    await guidedForm.innerText(),
    /Hebrew Existing.*4\/6 sampled/s,
    "The dominant sampled model is evidence only and remains an explicit choice.",
  );

  await intendedModel.selectOption("Hebrew Existing");
  const guidedRepresentativeFront = guidedForm.locator('iframe[title="Hebrew Existing guided representative front"]');
  await guidedRepresentativeFront.waitFor();
  const guidedRepresentativeFrame = guidedRepresentativeFront.contentFrame();
  assert.match(await guidedRepresentativeFrame.locator("body").innerText(), /שלום/);
  assert.equal(await guidedRepresentativeFrame.locator("script").count(), 0);
  assert.equal(await guidedRepresentativeFrame.locator("img[src]").count(), 0);
  assert.equal(await guidedRepresentativeFrame.locator("a[href]").count(), 0);
  await guidedForm.getByRole("button", { name: "Another representative" }).click();

  const saveGuided = guidedForm.getByRole("button", { name: "Save profile + language route" });
  assert.equal(await saveGuided.isDisabled(), true, "Incomplete mapping must block Save.");
  await guidedForm.getByLabel("Map Collector Prompt").selectOption("Hebrew");
  assert.equal(await saveGuided.isDisabled(), true, "Missing Answer mapping must still block Save.");
  await guidedForm.getByLabel("Map Collector Answer").selectOption("Russian");
  assert.equal(await saveGuided.isDisabled(), false, "Valid ACCP-014 mapping should enable Save.");

  const payloadPreview = guidedForm.getByLabel("Outgoing mapped payload preview");
  assert.match(await payloadPreview.innerText(), /Hebrew\s+Prompt: Example prompt/);
  assert.match(await payloadPreview.innerText(), /Russian\s+Answer: Example answer/);
  assert.match(await payloadPreview.innerText(), /Example\s+Untouched \/ omitted/);

  const guidedAccessibility = await new AxeBuilder({ page: panel })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  assert.equal(
    guidedAccessibility.violations.length,
    0,
    "Guided profile accessibility violations:\n" + JSON.stringify(guidedAccessibility.violations, null, 2),
  );

  await saveGuided.click();
  await guidedForm.waitFor({ state: "detached" });

  const hebrewGuidedProfile = guidedProfiles.locator(".saved-profile", { hasText: "Hebrew (he)" }).filter({
    hasText: "Hebrew Existing",
  });
  await hebrewGuidedProfile.waitFor();
  assert.match(await hebrewGuidedProfile.innerText(), /deck ID 2/);
  assert.match(await hebrewGuidedProfile.innerText(), /model ID 11/);
  assert.match(await hebrewGuidedProfile.innerText(), /capture/);

  const storedHebrewGuided = await panel.evaluate(async () => {
    const stored = await chrome.storage.local.get("collectorSettings");
    const current = stored.collectorSettings;
    const profile = current.exportProfiles.find(
      (candidate) => candidate.language === "he" && candidate.modelName === "Hebrew Existing",
    );
    return { current, profile };
  });
  assert.ok(storedHebrewGuided.profile);
  assert.equal(storedHebrewGuided.profile.deckId, "2");
  assert.equal(storedHebrewGuided.profile.modelId, "11");
  assert.equal(storedHebrewGuided.profile.identityStrategy, "collector-tag");
  assert.equal(
    JSON.stringify(storedHebrewGuided.current).includes("שלום"),
    false,
    "Representative study content must not be persisted into settings.",
  );
  assert.equal(
    JSON.stringify(storedHebrewGuided.current).includes("house"),
    false,
    "Alternate representative study content must not be persisted into settings.",
  );
  assert.equal(storedHebrewGuided.current.captureProfileId, storedHebrewGuided.profile.id);
  assert.equal(
    storedHebrewGuided.current.languageRoutes.find((route) => route.language === "he")?.profileId,
    storedHebrewGuided.profile.id,
  );

  // Reopen/edit loads the saved identity and mapping through fresh live evidence.
  await hebrewGuidedProfile.getByRole("button", { name: "Edit" }).click();
  const reopenedGuided = guidedProfiles.locator(".guided-profile-form");
  assert.equal(await reopenedGuided.getByLabel("Profile language").inputValue(), "he");
  assert.equal(await reopenedGuided.getByLabel("Live Anki deck").inputValue(), "Hebrew RU");
  await reopenedGuided.getByLabel("Intended note type").waitFor();
  assert.equal(await reopenedGuided.getByLabel("Intended note type").inputValue(), "Hebrew Existing");
  await reopenedGuided.getByLabel("Map Collector Prompt").waitFor();
  assert.equal(await reopenedGuided.getByLabel("Map Collector Prompt").inputValue(), "Hebrew");
  assert.equal(await reopenedGuided.getByLabel("Map Collector Answer").inputValue(), "Russian");
  await reopenedGuided.getByRole("button", { name: "Cancel" }).click();

  // Offline refresh must preserve every saved setting and keep profiles visible.
  const beforeOfflineSettings = await panel.evaluate(async () => (await chrome.storage.local.get("collectorSettings")).collectorSettings);
  ankiAvailable = false;
  await clickPanelButton(panel, "Refresh from Anki");
  await panel.locator(".anki-catalog-status", { hasText: /Showing the last loaded decks|Could not connect to Anki/ }).waitFor();
  await hebrewGuidedProfile.waitFor();
  assert.equal(
    await guidedProfiles.getByRole("button", { name: "New profile" }).isDisabled(),
    true,
    "Live profile creation must be disabled while Anki is unavailable.",
  );
  const afterOfflineSettings = await panel.evaluate(async () => (await chrome.storage.local.get("collectorSettings")).collectorSettings);
  assert.deepEqual(afterOfflineSettings, beforeOfflineSettings, "Offline discovery must not rewrite saved profile configuration.");

  ankiAvailable = true;
  await clickPanelButton(panel, "Refresh from Anki");
  await panel.locator(".anki-catalog-status", { hasText: "Connected" }).waitFor();
  await hebrewGuidedProfile.getByRole("button", { name: "Revalidate" }).click();
  await hebrewGuidedProfile.getByText("Live validation passed.").waitFor();

  // Same-name deck replacement must fail closed and never rewrite the pinned ID.
  ankiDecks.set("Hebrew RU", 22);
  await hebrewGuidedProfile.getByRole("button", { name: "Revalidate" }).click();
  await hebrewGuidedProfile.getByText(/Same-name deck replacement rejected/).waitFor();
  let revalidatedStored = await panel.evaluate(async () => (await chrome.storage.local.get("collectorSettings")).collectorSettings);
  assert.equal(
    revalidatedStored.exportProfiles.find((profile) => profile.language === "he" && profile.modelName === "Hebrew Existing")?.deckId,
    "2",
  );
  ankiDecks.set("Hebrew RU", 2);
  await hebrewGuidedProfile.getByRole("button", { name: "Revalidate" }).click();
  await hebrewGuidedProfile.getByText("Live validation passed.").waitFor();

  // Missing live objects must be reported distinctly and must not alter saved identity.
  ankiDecks.delete("Hebrew RU");
  await hebrewGuidedProfile.getByRole("button", { name: "Revalidate" }).click();
  await hebrewGuidedProfile.getByText(/Saved deck is missing from live Anki/).waitFor();
  revalidatedStored = await panel.evaluate(async () => (await chrome.storage.local.get("collectorSettings")).collectorSettings);
  assert.equal(
    revalidatedStored.exportProfiles.find((profile) => profile.language === "he" && profile.modelName === "Hebrew Existing")?.deckId,
    "2",
  );
  ankiDecks.set("Hebrew RU", 2);
  await hebrewGuidedProfile.getByRole("button", { name: "Revalidate" }).click();
  await hebrewGuidedProfile.getByText("Live validation passed.").waitFor();

  // Same-name note-type replacement must also be rejected without identity rewriting.
  ankiModels.set("Hebrew Existing", 99);
  await hebrewGuidedProfile.getByRole("button", { name: "Revalidate" }).click();
  await hebrewGuidedProfile.getByText(/Same-name note-type replacement rejected/).waitFor();
  revalidatedStored = await panel.evaluate(async () => (await chrome.storage.local.get("collectorSettings")).collectorSettings);
  assert.equal(
    revalidatedStored.exportProfiles.find((profile) => profile.language === "he" && profile.modelName === "Hebrew Existing")?.modelId,
    "11",
  );
  ankiModels.set("Hebrew Existing", 11);
  await hebrewGuidedProfile.getByRole("button", { name: "Revalidate" }).click();
  await hebrewGuidedProfile.getByText("Live validation passed.").waitFor();

  ankiModels.delete("Hebrew Existing");
  await hebrewGuidedProfile.getByRole("button", { name: "Revalidate" }).click();
  await hebrewGuidedProfile.getByText(/Saved note type is missing from live Anki/).waitFor();
  revalidatedStored = await panel.evaluate(async () => (await chrome.storage.local.get("collectorSettings")).collectorSettings);
  assert.equal(
    revalidatedStored.exportProfiles.find((profile) => profile.language === "he" && profile.modelName === "Hebrew Existing")?.modelId,
    "11",
  );
  ankiModels.set("Hebrew Existing", 11);
  await hebrewGuidedProfile.getByRole("button", { name: "Revalidate" }).click();
  await hebrewGuidedProfile.getByText("Live validation passed.").waitFor();

  // Changed mapped fields fail closed until the original model shape is restored.
  ankiModelFields.set("Hebrew Existing", ["Hebrew", "Example"]);
  await hebrewGuidedProfile.getByRole("button", { name: "Revalidate" }).click();
  await hebrewGuidedProfile.getByText(/Mapped Anki field "Russian"/).waitFor();
  ankiModelFields.set("Hebrew Existing", ["Hebrew", "Russian", "Example"]);
  await hebrewGuidedProfile.getByRole("button", { name: "Revalidate" }).click();
  await hebrewGuidedProfile.getByText("Live validation passed.").waitFor();

  // Deliberately set the legacy global fallback to Serbian. Active-profile language
  // must still make normal capture Hebrew without maintaining that global.
  await setCaptureLanguage(panel, "sr");

  await selectText(contentPage, "#mapped-context", "Mapped context-menu phrase");
  await contentPage.bringToFront();
  const guidedContextResult = await panel.evaluate(
    async (activeTabId) => chrome.runtime.sendMessage({
      type: "E2E_CONTEXT_MENU_CLICK",
      tabId: activeTabId,
    }),
    tabId,
  );
  assert.equal(guidedContextResult?.ok, true, guidedContextResult?.error);
  const guidedContextCard = await cardForTerm(panel, "Mapped context-menu phrase");
  assert.match(
    await guidedContextCard.locator(".meta").first().innerText(),
    /^he\s+·/,
    "Context-menu capture must derive language from the active Hebrew profile, not the legacy sr fallback.",
  );

  await selectText(contentPage, "#mapped", "Mapped export phrase");
  await contentPage.bringToFront();
  await clickPanelButton(panel, "Collect selection");
  const mappedCard = await cardForTerm(panel, "Mapped export phrase");
  assert.match(await mappedCard.locator(".meta").first().innerText(), /^he\s+·/);
  const mappedReady = mappedCard.getByRole("button", { name: "Ready" });
  if (await mappedReady.count()) await mappedReady.click();
  await mappedCard.locator(".card-head > .pill", { hasText: "ready" }).waitFor();
  assert.match(await mappedCard.locator(".export-destination").innerText(), /Anki:\s*Hebrew RU/);

  ankiRequests.length = 0;
  await clickPanelButton(panel, "Send ready to Anki");
  await panel.locator(".notice", { hasText: "exported" }).waitFor();
  const mappedAdds = ankiRequests.filter(
    (request) => request.action === "addNote" && request.params?.note?.modelName === "Hebrew Existing",
  );
  assert.equal(mappedAdds.length, 1, "Guided mapped profile should export through the existing note type.");
  assert.deepEqual(
    Object.keys(mappedAdds[0].params.note.fields).sort(),
    ["Hebrew", "Russian"],
    "Mapped export must write only explicitly configured user-owned fields.",
  );
  assert.equal(mappedAdds[0].params.note.options.allowDuplicate, true);
  const mappedCardId = await mappedCard.getAttribute("data-card-id");
  assert.ok(mappedCardId);
  assert.ok(mappedAdds[0].params.note.tags.includes(collectorIdentityTagForE2e(mappedCardId)));
  assert.equal(
    ankiRequests.some((request) => ["createModel", "modelFieldAdd", "updateModelTemplates", "updateModelStyling"].includes(request.action)),
    false,
    "Guided setup/export must never mutate the user-owned note type.",
  );

  // Repeat send updates the same mapped note rather than creating a duplicate.
  ankiRequests.length = 0;
  await clickPanelButton(panel, "Send ready to Anki");
  await panel.locator(".notice", { hasText: "exported" }).waitFor();
  assert.equal(
    ankiRequests.filter((request) => request.action === "addNote" && request.params?.note?.modelName === "Hebrew Existing").length,
    0,
    "Repeat mapped export must remain idempotent.",
  );
  const mappedUpdates = ankiRequests.filter(
    (request) => request.action === "updateNoteFields" && Object.hasOwn(request.params?.note?.fields ?? {}, "Hebrew"),
  );
  assert.equal(mappedUpdates.length, 1);
  assert.deepEqual(Object.keys(mappedUpdates[0].params.note.fields).sort(), ["Hebrew", "Russian"]);

  // An already-used profile cannot change deck/model identity in place, while a
  // field remap requires a consequence acknowledgement.
  await openSettings(panel);
  const usedHebrewProfile = guidedProfiles.locator(".saved-profile", { hasText: "Hebrew Existing" }).filter({ hasText: "Hebrew (he)" });
  await usedHebrewProfile.getByRole("button", { name: "Edit" }).click();
  const usedEdit = guidedProfiles.locator(".guided-profile-form");
  await usedEdit.getByLabel("Intended note type").waitFor();
  await usedEdit.getByLabel("Intended note type").selectOption("Hebrew Verbs");
  await usedEdit.getByText(/Deck\/note-type identity changes are blocked/).waitFor();
  assert.equal(await usedEdit.getByRole("button", { name: "Save profile + language route" }).isDisabled(), true);

  await usedEdit.getByLabel("Intended note type").selectOption("Hebrew Existing");
  await usedEdit.getByLabel("Map Collector Prompt").waitFor();

  // ACCP-014 compatibility stays authoritative inside guided setup: mapping
  // Prompt to a field that is absent from every question side remains blocked.
  await usedEdit.getByLabel("Map Collector Prompt").selectOption("Russian");
  await usedEdit.getByLabel("Map Collector Answer").selectOption("Hebrew");
  await usedEdit.getByText(/not used on the question side/).waitFor();
  assert.equal(
    await usedEdit.getByRole("button", { name: "Save profile + language route" }).isDisabled(),
    true,
    "Acknowledgement must never override an incompatible mapping.",
  );

  // A compatible remap of an optional semantic field still carries consequences
  // for future updates to already-bound notes, so it requires acknowledgement.
  await usedEdit.getByLabel("Map Collector Prompt").selectOption("Hebrew");
  await usedEdit.getByLabel("Map Collector Answer").selectOption("Russian");
  await usedEdit.getByLabel("Map Collector Context").selectOption("Example");
  await usedEdit.getByText(/future updates write/).waitFor();
  const remapConfirm = usedEdit.getByLabel(/I understand this remap affects future updates/);
  assert.equal(await remapConfirm.isChecked(), false);
  assert.equal(await usedEdit.getByRole("button", { name: "Save profile + language route" }).isDisabled(), true);
  await remapConfirm.check();
  assert.equal(await usedEdit.getByRole("button", { name: "Save profile + language route" }).isDisabled(), false);
  await usedEdit.getByRole("button", { name: "Cancel" }).click();

  // Create a Serbian mapped profile using keyboard interaction only.
  await guidedProfiles.getByRole("button", { name: "New profile" }).focus();
  await panel.keyboard.press("Enter");
  const serbianForm = guidedProfiles.locator(".guided-profile-form");
  const serbianLanguage = serbianForm.getByLabel("Profile language");
  await serbianLanguage.focus();
  await panel.keyboard.press("Home");
  await panel.keyboard.press("ArrowDown");
  await panel.keyboard.press("ArrowDown");
  await panel.keyboard.press("Enter");
  assert.equal(await serbianLanguage.inputValue(), "sr");

  const serbianDeck = serbianForm.getByLabel("Live Anki deck");
  await serbianDeck.focus();
  await panel.keyboard.press("S");
  await panel.keyboard.press("Enter");
  assert.equal(await serbianDeck.inputValue(), "Serbian RU");
  await serbianForm.getByLabel("Intended note type").waitFor();

  const serbianModel = serbianForm.getByLabel("Intended note type");
  await serbianModel.focus();
  await panel.keyboard.press("Home");
  await panel.keyboard.press("ArrowDown");
  await panel.keyboard.press("Enter");
  assert.equal(await serbianModel.inputValue(), "Serbian Existing");
  await serbianForm.getByLabel("Map Collector Prompt").waitFor();

  await serbianForm.getByLabel("Map Collector Prompt").focus();
  await panel.keyboard.press("S");
  await panel.keyboard.press("Enter");
  await serbianForm.getByLabel("Map Collector Answer").focus();
  await panel.keyboard.press("R");
  await panel.keyboard.press("Enter");
  const serbianSave = serbianForm.getByRole("button", { name: "Save profile + language route" });
  assert.equal(await serbianSave.isDisabled(), false);
  await serbianSave.focus();
  await panel.keyboard.press("Enter");
  await serbianForm.waitFor({ state: "detached" });

  const serbianGuidedProfile = guidedProfiles.locator(".saved-profile", { hasText: "Serbian Existing" }).filter({
    hasText: "Serbian (sr)",
  });
  await serbianGuidedProfile.waitFor();
  assert.match(await serbianGuidedProfile.innerText(), /deck ID 3/);
  assert.match(await serbianGuidedProfile.innerText(), /model ID 13/);

  // The Serbian profile is now active; a conflicting legacy fallback must not relabel capture.
  await setCaptureLanguage(panel, "he");
  await selectText(contentPage, "#mapped-sr", "Serbian mapped export phrase");
  await contentPage.bringToFront();
  await clickPanelButton(panel, "Collect selection");
  const serbianMappedCard = await cardForTerm(panel, "Serbian mapped export phrase");
  assert.match(await serbianMappedCard.locator(".meta").first().innerText(), /^sr\s+·/);
  const serbianReady = serbianMappedCard.getByRole("button", { name: "Ready" });
  if (await serbianReady.count()) await serbianReady.click();
  ankiRequests.length = 0;
  await clickPanelButton(panel, "Send ready to Anki");
  await panel.locator(".notice", { hasText: "exported" }).waitFor();
  const serbianAdds = ankiRequests.filter(
    (request) => request.action === "addNote" && request.params?.note?.modelName === "Serbian Existing",
  );
  assert.equal(serbianAdds.length, 1);
  assert.deepEqual(Object.keys(serbianAdds[0].params.note.fields).sort(), ["Russian", "Serbian"]);
  assert.equal(
    ankiRequests.some((request) => ["createModel", "modelFieldAdd", "updateModelTemplates", "updateModelStyling"].includes(request.action)),
    false,
  );

  // Duolingo visible scanning must use the same active Serbian profile language.
  await pairsPage.bringToFront();
  const profileDrivenScan = await panel.evaluate(
    async () => chrome.runtime.sendMessage({ type: "DUOLINGO_SCAN_ACTIVE" }),
  );
  assert.equal(profileDrivenScan?.ok, true, profileDrivenScan?.error);
  const profileDrivenBatch = await panel.evaluate(
    async () => chrome.runtime.sendMessage({ type: "GET_STAGED_BATCH" }),
  );
  assert.equal(
    profileDrivenBatch.batch.candidates.some(
      (candidate) => candidate.surfaceText === "מרק" && candidate.language === "sr",
    ),
    true,
    "Duolingo visible scan must derive language from the active Serbian profile, not the legacy he fallback.",
  );
  await contentPage.bringToFront();

  // ACCP-003: a canonical edit that would merge independently exported units is
  // blocked before any corpus mutation. Re-open the Serbian card because the
  // mapped-export acceptance above intentionally focused a different detail.
  secondRoutingCard = await cardForTerm(panel, "Context menu phrase");
  await secondRoutingCard.getByRole("button", { name: "Edit" }).click();
  const conflictEditor = secondRoutingCard.locator(".editor");
  await conflictEditor.getByLabel("Canonical form").fill("Aunque llueva");
  await conflictEditor.getByLabel("Language code").fill("he");
  const conflictPreview = secondRoutingCard.locator(".canonicalization-preview.conflict");
  await conflictPreview.waitFor();
  assert.match(
    await conflictPreview.innerText(),
    /(different export destinations|different Anki notes)/i,
    "Unsafe consolidation should explain the identity conflict before Save.",
  );
  assert.equal(
    await secondRoutingCard.getByRole("button", { name: "Save" }).isDisabled(),
    true,
    "Conflict preview must block Save instead of relying on a failed write.",
  );
  await secondRoutingCard.getByRole("button", { name: "Cancel" }).click();

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
  const countBeforeRestrictedCapture = await termCount(panel);
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
  assert.equal(
    await termCount(panel),
    countBeforeRestrictedCapture,
    "Restricted-page failure must not add data.",
  );

  // ACCP-011: long study targets stay compact and scannable instead of expanding
  // the queue into repeated full-card blocks.
  const longTarget = "Esta frase deliberadamente larga contiene muchas palabras útiles para comprobar que una fila compacta sigue siendo fácil de escanear";
  await selectText(contentPage, "#long", longTarget);
  await contentPage.bringToFront();
  await clickPanelButton(panel, "Collect selection");
  const longRow = await queueRowForTerm(panel, longTarget);
  await longRow.waitFor();
  const longTermStyle = await longRow.locator(".term").evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      lineClamp: style.getPropertyValue("-webkit-line-clamp"),
      overflow: style.overflow,
    };
  });
  assert.equal(longTermStyle.lineClamp, "2", "Long queue terms should clamp to two lines.");
  assert.equal(longTermStyle.overflow, "hidden", "Long queue terms should not expand the entire review feed.");
  assert.equal(
    await panel.locator(".detail-card").count(),
    0,
    "Capturing a long item should keep the user in the compact queue.",
  );

  // ACCP-003: safe canonical consolidation is previewed, then committed without
  // losing either observed form/context.
  await setCaptureLanguage(panel, "es");
  const countBeforeCanonicalPair = await termCount(panel);

  await selectText(contentPage, "#canonical-base", "tener");
  await contentPage.bringToFront();
  await clickPanelButton(panel, "Collect selection");
  await (await queueRowForTerm(panel, "tener")).waitFor();

  await selectText(contentPage, "#canonical-observed", "Tengo");
  await contentPage.bringToFront();
  await clickPanelButton(panel, "Collect selection");
  await (await queueRowForTerm(panel, "Tengo")).waitFor();
  assert.equal(
    await termCount(panel),
    countBeforeCanonicalPair + 2,
    "Canonicalization fixture should begin as two distinct lexical units.",
  );

  const observedCanonicalCard = await cardForTerm(panel, "Tengo");
  await observedCanonicalCard.getByRole("button", { name: "Edit" }).click();
  await observedCanonicalCard.locator(".editor").getByLabel("Canonical form").fill("tener");
  const consolidationPreview = observedCanonicalCard.locator(".canonicalization-preview.consolidate");
  await consolidationPreview.waitFor();
  assert.match(
    await consolidationPreview.innerText(),
    /1 \+ 1 occurrences become 2/,
    "Consolidation preview should make the occurrence consequence explicit.",
  );
  assert.match(
    await consolidationPreview.innerText(),
    /returns to Inbox/i,
    "Consolidation preview should make re-approval explicit.",
  );
  await observedCanonicalCard.getByRole("button", { name: "Save" }).click();
  await observedCanonicalCard.locator(".editor").waitFor({ state: "detached" });

  const consolidatedCard = panel.locator(".detail-card", {
    has: panel.locator(".term", { hasText: "tener" }),
  });
  await consolidatedCard.waitFor();
  const consolidatedEvidence = consolidatedCard.locator(".canonical-evidence");
  await consolidatedEvidence.getByText("Observed forms (2)").waitFor();
  assert.match(await consolidatedEvidence.innerText(), /tener/);
  assert.match(await consolidatedEvidence.innerText(), /Tengo/);
  assert.match(await consolidatedEvidence.innerText(), /Quiero tener tiempo para estudiar\./);
  assert.match(await consolidatedEvidence.innerText(), /Tengo tiempo para estudiar hoy\./);
  await ensureQueue(panel);
  assert.equal(
    await termCount(panel),
    countBeforeCanonicalPair + 1,
    "Successful canonical consolidation should reduce two compatible units to one.",
  );

  console.log("Browser extension capture, compact queue/detail, canonicalization, keyboard, accessibility, and permission checks passed.");
} finally {
  await context?.close().catch(() => undefined);

  // Failed browser assertions must still terminate the fixture deterministically.
  // Explicitly close active HTTP connections before awaiting server shutdown so
  // GitHub Actions exposes the real test failure instead of hanging until its
  // outer job timeout.
  server.closeAllConnections?.();
  ankiServer.closeAllConnections?.();
  await Promise.all([
    new Promise((resolveClose) => server.close(resolveClose)),
    new Promise((resolveClose) => ankiServer.close(resolveClose)),
  ]);
  await rm(userDataDir, { recursive: true, force: true });
}
