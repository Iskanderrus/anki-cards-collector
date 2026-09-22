declare const __COLLECTOR_E2E__: boolean;

import {
  BatchCapturePipeline,
  type BatchCandidateEdit,
  type BatchCaptureEvidence,
  type BatchCaptureResult,
  type BatchCommitRequest,
} from "./capture/batch";
import { sanitizeSourceUrl } from "./capture/source-url";
import type { CaptureDraft, SourceUrlMode } from "./core/types";
import { captureLanguageForSettings, loadSettings } from "./settings";
import { repository } from "./storage/repository";

type CaptureResponse = { ok: true; draft: CaptureDraft | null } | { ok: false; error: string };

interface VisibleSessionStatus {
  active: boolean;
  sessionId?: string;
  candidateCount: number;
  startedAt?: string;
}

type VisibleContentResponse =
  | {
      ok: true;
      evidence?: BatchCaptureEvidence[];
      status?: VisibleSessionStatus;
      sessionId?: string;
      supported?: boolean;
    }
  | { ok: false; error: string };

const batchPipeline = new BatchCapturePipeline(repository);
const STAGED_BATCH_SESSION_KEY = "collectorStagedBatchV1";
const VISIBLE_SESSION_OWNER_KEY = "collectorVisibleSessionOwnerV1";

interface StoredStagedBatch {
  version: 1;
  batchId: string;
  evidence: BatchCaptureEvidence[];
}

interface StoredVisibleSessionOwner {
  version: 1;
  tabId: number;
  sessionId: string;
}

let visibleSessionOwner: StoredVisibleSessionOwner | null = null;
let stagedBatchQueue: Promise<void> = Promise.resolve();
let failNextStagedBatchPersistenceForE2E = false;
let failNextStagedCommitForE2E = false;

function cloneEvidence(evidence: BatchCaptureEvidence): BatchCaptureEvidence {
  return {
    ...evidence,
    source: { ...evidence.source },
    adapterMetadata: evidence.adapterMetadata ? { ...evidence.adapterMetadata } : undefined,
  };
}

function evidenceFromResult(result: BatchCaptureResult): BatchCaptureEvidence[] {
  return result.candidates.flatMap((candidate) =>
    Array.from(
      { length: Math.max(1, candidate.duplicateCount) },
      () => cloneEvidence(asEvidence(candidate)),
    )
  );
}

function isStoredStagedBatch(value: unknown): value is StoredStagedBatch {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredStagedBatch>;
  if (candidate.version !== 1 || typeof candidate.batchId !== "string" || !candidate.batchId.trim()) {
    return false;
  }
  if (!Array.isArray(candidate.evidence)) return false;

  return candidate.evidence.every((item) => {
    if (!item || typeof item !== "object") return false;
    const evidence = item as Partial<BatchCaptureEvidence>;
    return typeof evidence.surfaceText === "string"
      && typeof evidence.context === "string"
      && typeof evidence.language === "string"
      && typeof evidence.capturedAt === "string"
      && Boolean(evidence.source)
      && typeof evidence.source?.kind === "string"
      && typeof evidence.source?.adapter === "string"
      && typeof evidence.source?.url === "string"
      && typeof evidence.source?.title === "string";
  });
}

async function loadStoredStagedBatch(): Promise<StoredStagedBatch | null> {
  const stored = await chrome.storage.session.get(STAGED_BATCH_SESSION_KEY);
  const value = stored[STAGED_BATCH_SESSION_KEY];
  if (value === undefined) return null;

  if (!isStoredStagedBatch(value)) {
    await chrome.storage.session.remove(STAGED_BATCH_SESSION_KEY);
    return null;
  }

  return {
    version: 1,
    batchId: value.batchId,
    evidence: value.evidence.map(cloneEvidence),
  };
}

async function persistStagedBatch(result: BatchCaptureResult | null): Promise<void> {
  if (__COLLECTOR_E2E__ && failNextStagedBatchPersistenceForE2E) {
    failNextStagedBatchPersistenceForE2E = false;
    throw new Error("Injected staged-session persistence failure.");
  }

  if (!result || result.candidates.length === 0) {
    await chrome.storage.session.remove(STAGED_BATCH_SESSION_KEY);
    return;
  }

  const payload: StoredStagedBatch = {
    version: 1,
    batchId: result.batchId,
    evidence: evidenceFromResult(result),
  };
  await chrome.storage.session.set({ [STAGED_BATCH_SESSION_KEY]: payload });
}

function withStagedBatchLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = stagedBatchQueue.then(operation, operation);
  stagedBatchQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function restoreStagedBatchUnlocked(): Promise<BatchCaptureResult | null> {
  const active = batchPipeline.getActiveBatch();
  if (active) return active;

  const stored = await loadStoredStagedBatch();
  if (!stored) return null;

  return batchPipeline.stageBatch(stored.batchId, stored.evidence);
}

async function currentStagedBatch(): Promise<BatchCaptureResult | null> {
  return withStagedBatchLock(() => restoreStagedBatchUnlocked());
}

function isStoredVisibleSessionOwner(value: unknown): value is StoredVisibleSessionOwner {
  if (!value || typeof value !== "object") return false;
  const owner = value as Partial<StoredVisibleSessionOwner>;
  return owner.version === 1
    && Number.isInteger(owner.tabId)
    && (owner.tabId ?? -1) >= 0
    && typeof owner.sessionId === "string"
    && owner.sessionId.trim().length > 0;
}

async function loadVisibleSessionOwner(): Promise<StoredVisibleSessionOwner | null> {
  if (visibleSessionOwner) return visibleSessionOwner;

  const stored = await chrome.storage.session.get(VISIBLE_SESSION_OWNER_KEY);
  const value = stored[VISIBLE_SESSION_OWNER_KEY];
  if (value === undefined) return null;

  if (!isStoredVisibleSessionOwner(value)) {
    await chrome.storage.session.remove(VISIBLE_SESSION_OWNER_KEY);
    return null;
  }

  visibleSessionOwner = { ...value };
  return visibleSessionOwner;
}

async function persistVisibleSessionOwner(tabId: number, sessionId: string): Promise<StoredVisibleSessionOwner> {
  const owner: StoredVisibleSessionOwner = {
    version: 1,
    tabId,
    sessionId,
  };
  await chrome.storage.session.set({ [VISIBLE_SESSION_OWNER_KEY]: owner });
  visibleSessionOwner = owner;
  return owner;
}

async function clearVisibleSessionOwner(
  expected?: Pick<StoredVisibleSessionOwner, "tabId" | "sessionId">,
): Promise<void> {
  const current = await loadVisibleSessionOwner();
  if (expected && current
    && (current.tabId !== expected.tabId || current.sessionId !== expected.sessionId)) {
    return;
  }

  visibleSessionOwner = null;
  await chrome.storage.session.remove(VISIBLE_SESSION_OWNER_KEY);
}

interface ValidatedVisibleSessionOwner {
  owner: StoredVisibleSessionOwner;
  response: Extract<VisibleContentResponse, { ok: true }>;
}

async function validateVisibleSessionOwner(): Promise<ValidatedVisibleSessionOwner | null> {
  const owner = await loadVisibleSessionOwner();
  if (!owner) return null;

  try {
    const response = await chrome.tabs.sendMessage(owner.tabId, {
      type: "DUOLINGO_GET_VISIBLE_SESSION_STATUS",
    }) as VisibleContentResponse;

    if (response?.ok
      && response.status?.active
      && response.status.sessionId === owner.sessionId) {
      return { owner, response };
    }
  } catch {
    // The owner tab/content context disappeared. The stored owner is stale.
  }

  await clearVisibleSessionOwner(owner);
  return null;
}

async function discoverVisibleSessionOnActiveTab(): Promise<ValidatedVisibleSessionOwner | null> {
  const tabId = await activeTabId();

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "DUOLINGO_GET_VISIBLE_SESSION_STATUS",
    }) as VisibleContentResponse;

    if (!response?.ok || !response.status?.active || !response.status.sessionId) {
      return null;
    }

    const owner = await persistVisibleSessionOwner(tabId, response.status.sessionId);
    return { owner, response };
  } catch {
    return null;
  }
}

async function resolveVisibleSessionOwner(): Promise<ValidatedVisibleSessionOwner | null> {
  return await validateVisibleSessionOwner() ?? await discoverVisibleSessionOnActiveTab();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Capture failed.";
}

async function injectContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
}

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error("No active browser tab.");
  return tab.id;
}

async function collectFromTab(
  tabId: number,
  language: string,
  sourceUrlMode: SourceUrlMode,
): Promise<void> {
  await injectContentScript(tabId);

  const response = await chrome.tabs.sendMessage(tabId, {
    type: "CAPTURE_SELECTION",
  }) as CaptureResponse;

  if (!response?.ok) throw new Error(response?.error ?? "Could not read the current selection.");
  if (!response.draft) throw new Error("Select a word, phrase, or sentence first.");

  await repository.capture({
    ...response.draft,
    language,
    source: {
      ...response.draft.source,
      url: sanitizeSourceUrl(response.draft.source.url, sourceUrlMode),
    },
  });
  chrome.runtime.sendMessage({ type: "DATA_CHANGED" }).catch(() => undefined);
}

function stagedSummary(result: BatchCaptureResult | null) {
  if (!result) {
    return {
      batchId: null,
      candidateCount: 0,
      dispositions: {
        new: 0,
        "already-represented": 0,
        "repeated-evidence": 0,
        "needs-review": 0,
      },
    };
  }

  return {
    batchId: result.batchId,
    candidateCount: result.candidates.length,
    dispositions: {
      new: result.candidates.filter((candidate) => candidate.disposition === "new").length,
      "already-represented": result.candidates.filter(
        (candidate) => candidate.disposition === "already-represented",
      ).length,
      "repeated-evidence": result.candidates.filter(
        (candidate) => candidate.disposition === "repeated-evidence",
      ).length,
      "needs-review": result.candidates.filter(
        (candidate) => candidate.disposition === "needs-review",
      ).length,
    },
  };
}

function asEvidence(candidate: BatchCaptureResult["candidates"][number]): BatchCaptureEvidence {
  return {
    surfaceText: candidate.surfaceText,
    context: candidate.context,
    language: candidate.language,
    source: candidate.source,
    capturedAt: candidate.capturedAt,
    adapterMetadata: candidate.adapterMetadata,
  };
}

async function stageVisibleEvidence(
  evidence: readonly BatchCaptureEvidence[],
  sourceUrlMode: SourceUrlMode,
  requestedBatchId: string,
) {
  return withStagedBatchLock(async () => {
    const existing = await restoreStagedBatchUnlocked();
    const previousEvidence = existing ? evidenceFromResult(existing) : [];
    const prepared = evidence.map((candidate) => ({
      ...cloneEvidence(candidate),
      // Preserve the immutable language attached when the evidence was observed.
      // Settings may change while a session is active.
      language: candidate.language.trim().toLowerCase() || "und",
      source: {
        ...candidate.source,
        url: sanitizeSourceUrl(candidate.source.url, sourceUrlMode),
      },
    }));

    const merged = [...previousEvidence, ...prepared];
    const result = await batchPipeline.stageBatch(
      existing?.batchId ?? requestedBatchId,
      merged,
    );

    try {
      await persistStagedBatch(result);
    } catch (error) {
      if (existing) {
        await batchPipeline.stageBatch(existing.batchId, previousEvidence);
      } else {
        batchPipeline.discard();
      }
      throw error;
    }

    return stagedSummary(result);
  });
}

async function mutateStagedBatch(
  operation: (active: BatchCaptureResult) => Promise<BatchCaptureResult | null>,
): Promise<BatchCaptureResult | null> {
  return withStagedBatchLock(async () => {
    const existing = await restoreStagedBatchUnlocked();
    if (!existing) throw new Error("No staged batch is active.");

    const previousEvidence = evidenceFromResult(existing);
    try {
      const result = await operation(existing);
      await persistStagedBatch(result);
      return result;
    } catch (error) {
      await batchPipeline.stageBatch(existing.batchId, previousEvidence);
      throw error;
    }
  });
}

async function editStagedCandidate(
  candidateId: string,
  changes: BatchCandidateEdit,
): Promise<BatchCaptureResult> {
  const result = await mutateStagedBatch(
    () => batchPipeline.editCandidate(candidateId, changes),
  );
  if (!result) throw new Error("Staged batch disappeared during edit.");
  return result;
}

async function discardStagedCandidates(
  candidateIds: readonly string[],
): Promise<BatchCaptureResult | null> {
  return mutateStagedBatch(
    () => batchPipeline.discardCandidates(candidateIds),
  );
}

async function commitStagedCandidates(request: BatchCommitRequest) {
  return withStagedBatchLock(async () => {
    const existing = await restoreStagedBatchUnlocked();
    if (!existing) throw new Error("No staged batch is active.");

    let result;
    try {
      if (__COLLECTOR_E2E__ && failNextStagedCommitForE2E) {
        failNextStagedCommitForE2E = false;
        throw new Error("Injected staged commit failure.");
      }

      result = await batchPipeline.commit(request);
    } catch (error) {
      let active = batchPipeline.getActiveBatch();
      let recoveryDetail = "";

      try {
        // A failed transaction may mean corpus ownership changed after staging.
        // Refresh the retained batch before returning control so the UI can expose
        // the current Needs review owner set instead of trapping the user in a
        // stale retry loop.
        active = await batchPipeline.refreshActiveBatch();
        await persistStagedBatch(active);
      } catch (recoveryError) {
        active = batchPipeline.getActiveBatch();
        recoveryDetail = ` Staged evidence was retained, but its recovery snapshot could not be refreshed: ${errorMessage(recoveryError)}.`;
      }

      return {
        ok: false as const,
        error: `${errorMessage(error)}${recoveryDetail}`,
        batch: active,
        staged: stagedSummary(active),
      };
    }

    const active = batchPipeline.getActiveBatch();
    let warning = result.warning;

    try {
      await persistStagedBatch(active);
    } catch (error) {
      try {
        // A transient session-storage failure must not make a completed corpus
        // transaction look uncommitted. Retry the transient snapshot once; even
        // if it remains unavailable, a stale snapshot reclassifies committed
        // evidence as already represented on the next worker start.
        await persistStagedBatch(active);
      } catch {
        const persistenceWarning = `Corpus import completed, but the transient staged snapshot could not be updated: ${errorMessage(error)} Reload Staged review before retrying; committed evidence will reclassify as already represented.`;
        warning = warning ? `${warning} ${persistenceWarning}` : persistenceWarning;
      }
    }

    chrome.runtime.sendMessage({ type: "DATA_CHANGED" }).catch(() => undefined);
    return {
      ok: true as const,
      result,
      batch: active,
      staged: stagedSummary(active),
      warning,
    };
  });
}

async function scanVisibleDuolingo(): Promise<{
  foundCount: number;
  staged: ReturnType<typeof stagedSummary>;
}> {
  const tabId = await activeTabId();
  const settings = await loadSettings();
  await injectContentScript(tabId);

  const response = await chrome.tabs.sendMessage(tabId, {
    type: "DUOLINGO_SCAN_VISIBLE",
    language: captureLanguageForSettings(settings),
  }) as VisibleContentResponse;

  if (!response?.ok) throw new Error(response?.error ?? "Could not scan visible Duolingo material.");

  const evidence = response.evidence ?? [];
  const staged = await stageVisibleEvidence(
    evidence,
    settings.sourceUrlMode,
    `duolingo-visible-${crypto.randomUUID()}`,
  );

  return { foundCount: evidence.length, staged };
}

async function startVisibleDuolingoSession(): Promise<{
  status: VisibleSessionStatus;
  staged: ReturnType<typeof stagedSummary>;
  liveEvidence: BatchCaptureEvidence[];
}> {
  const existing = await resolveVisibleSessionOwner();
  if (existing) {
    return {
      status: existing.response.status!,
      staged: stagedSummary(await currentStagedBatch()),
      liveEvidence: existing.response.evidence ?? [],
    };
  }

  const tabId = await activeTabId();
  const settings = await loadSettings();
  await injectContentScript(tabId);

  const response = await chrome.tabs.sendMessage(tabId, {
    type: "DUOLINGO_START_VISIBLE_SESSION",
    language: captureLanguageForSettings(settings),
  }) as VisibleContentResponse;

  if (!response?.ok || !response.status?.active || !response.status.sessionId) {
    throw new Error(response?.ok ? "Could not start Duolingo backfill." : response?.error);
  }

  try {
    await persistVisibleSessionOwner(tabId, response.status.sessionId);
  } catch (error) {
    await chrome.tabs.sendMessage(tabId, {
      type: "DUOLINGO_CANCEL_VISIBLE_SESSION",
      sessionId: response.status.sessionId,
    }).catch(() => undefined);
    throw error;
  }

  return {
    status: response.status,
    staged: stagedSummary(await currentStagedBatch()),
    liveEvidence: response.evidence ?? [],
  };
}

async function visibleDuolingoSessionStatus(): Promise<{
  supported: boolean;
  status: VisibleSessionStatus;
  staged: ReturnType<typeof stagedSummary>;
  liveEvidence: BatchCaptureEvidence[];
}> {
  const resolved = await resolveVisibleSessionOwner();
  if (resolved) {
    return {
      supported: resolved.response.supported === true,
      status: resolved.response.status!,
      staged: stagedSummary(await currentStagedBatch()),
      liveEvidence: resolved.response.evidence ?? [],
    };
  }

  return {
    supported: false,
    status: { active: false, candidateCount: 0 },
    staged: stagedSummary(await currentStagedBatch()),
    liveEvidence: [],
  };
}

async function stopVisibleDuolingoSession(): Promise<{
  foundCount: number;
  status: VisibleSessionStatus;
  staged: ReturnType<typeof stagedSummary>;
}> {
  const resolved = await resolveVisibleSessionOwner();
  if (!resolved) throw new Error("No active Duolingo backfill session.");

  const { owner } = resolved;
  const settings = await loadSettings();
  const response = await chrome.tabs.sendMessage(owner.tabId, {
    type: "DUOLINGO_PREPARE_STOP_VISIBLE_SESSION",
  }) as VisibleContentResponse;

  if (!response?.ok) throw new Error(response?.error ?? "Could not prepare Duolingo backfill for staging.");
  if (response.sessionId !== owner.sessionId) {
    throw new Error("Duolingo backfill session ownership changed before staging.");
  }

  const evidence = response.evidence ?? [];
  const staged = await stageVisibleEvidence(
    evidence,
    settings.sourceUrlMode,
    `duolingo-session-${owner.sessionId}`,
  );

  const confirmation = await chrome.tabs.sendMessage(owner.tabId, {
    type: "DUOLINGO_CONFIRM_STOP_VISIBLE_SESSION",
    sessionId: owner.sessionId,
  }) as VisibleContentResponse;

  if (!confirmation?.ok || confirmation.status?.active) {
    throw new Error(
      confirmation?.ok
        ? "Duolingo backfill staging succeeded, but the live session could not be finalized."
        : confirmation?.error ?? "Could not finalize Duolingo backfill.",
    );
  }

  await clearVisibleSessionOwner(owner);

  return {
    foundCount: evidence.length,
    status: confirmation.status ?? { active: false, candidateCount: evidence.length },
    staged,
  };
}

async function stageAutoTerminatedDuolingoSession(
  message: {
    sessionId?: string;
    evidence?: BatchCaptureEvidence[];
    reason?: string;
  },
  tabId: number | undefined,
): Promise<{
  foundCount: number;
  staged: ReturnType<typeof stagedSummary>;
}> {
  const settings = await loadSettings();
  const evidence = message.evidence ?? [];
  const sessionId = String(message.sessionId ?? "").trim();
  if (!sessionId) throw new Error("Automatic Duolingo session handoff is missing a session id.");

  const staged = await stageVisibleEvidence(
    evidence,
    settings.sourceUrlMode,
    `duolingo-session-${sessionId}`,
  );

  if (tabId !== undefined) {
    await clearVisibleSessionOwner({ tabId, sessionId });
  }

  chrome.runtime.sendMessage({
    type: "DUOLINGO_VISIBLE_SESSION_AUTO_STAGED",
    reason: message.reason ?? "automatic-termination",
    foundCount: evidence.length,
    staged,
  }).catch(() => undefined);

  return {
    foundCount: evidence.length,
    staged,
  };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "collect-selection",
    title: "Collect for Anki",
    contexts: ["selection"],
  });

  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

async function captureFromContextMenu(tabId: number): Promise<{ ok: boolean; error?: string }> {
  await chrome.sidePanel.open({ tabId }).catch(() => undefined);

  try {
    const settings = await loadSettings();
    await collectFromTab(tabId, captureLanguageForSettings(settings), settings.sourceUrlMode);
    return { ok: true };
  } catch (error) {
    const message = errorMessage(error);
    chrome.runtime.sendMessage({
      type: "CAPTURE_ERROR",
      error: message,
    }).catch(() => undefined);
    return { ok: false, error: message };
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const tabId = tab?.id;
  if (info.menuItemId !== "collect-selection" || tabId === undefined) return;
  void captureFromContextMenu(tabId);
});

if (__COLLECTOR_E2E__) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "E2E_FAIL_NEXT_STAGED_BATCH_PERSISTENCE") {
      failNextStagedBatchPersistenceForE2E = true;
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "E2E_FAIL_NEXT_STAGED_COMMIT") {
      failNextStagedCommitForE2E = true;
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "E2E_REPLACE_STAGED_BATCH") {
      const evidence = Array.isArray(message.evidence)
        ? message.evidence as BatchCaptureEvidence[]
        : [];
      void withStagedBatchLock(async () => {
        const result = await batchPipeline.stageBatch(
          String(message.batchId ?? `e2e-${crypto.randomUUID()}`),
          evidence,
        );
        await persistStagedBatch(result);
        return result;
      })
        .then((batch) => sendResponse({ ok: true, batch, staged: stagedSummary(batch) }))
        .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
      return true;
    }

    if (message?.type === "E2E_SEED_OBSERVED_OWNER") {
      void (async () => {
        const surfaceText = String(message.surfaceText ?? "").trim();
        const canonicalText = String(message.canonicalText ?? "").trim();
        const language = String(message.language ?? "he").trim() || "he";
        if (!surfaceText || !canonicalText) {
          throw new Error("E2E observed-owner fixture requires surfaceText and canonicalText.");
        }

        const capturedAt = String(
          message.capturedAt ?? "2026-09-22T15:30:00.000Z",
        );
        const source = {
          kind: "web" as const,
          adapter: "e2e-late-owner",
          url: "https://example.test/late-owner",
          title: "E2E late ownership fixture",
        };
        const item = await repository.capture({
          text: canonicalText,
          context: `${canonicalText} fixture context.`,
          language,
          source,
          capturedAt,
        });
        const updated = await repository.update(item.lexicalUnit.id, {
          canonicalText,
          language,
          note: "",
          occurrenceId: item.occurrences[0]?.id,
          surfaceText,
          context: `${canonicalText} fixture context.`,
        });
        chrome.runtime.sendMessage({ type: "DATA_CHANGED" }).catch(() => undefined);
        return updated.lexicalUnit.id;
      })()
        .then((ownerId) => sendResponse({ ok: true, ownerId }))
        .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
      return true;
    }

    if (message?.type === "E2E_SEED_AMBIGUOUS_OWNERS") {
      void (async () => {
        const source = {
          kind: "web" as const,
          adapter: "e2e-ambiguous-owner",
          url: "https://example.test/ambiguous",
          title: "E2E ambiguous ownership fixture",
        };
        const owners: string[] = [];
        for (const [index, canonicalText] of ["בעלים ראשון", "בעלים שני"].entries()) {
          const capturedAt = `2026-09-22T12:0${index}:00.000Z`;
          const item = await repository.capture({
            text: canonicalText,
            context: `${canonicalText} בהקשר.`,
            language: "he",
            source,
            capturedAt,
          });
          const updated = await repository.update(item.lexicalUnit.id, {
            canonicalText,
            language: "he",
            note: "",
            occurrenceId: item.occurrences[0]?.id,
            surfaceText: "כתב",
            context: `${canonicalText} בהקשר.`,
          });
          owners.push(updated.lexicalUnit.id);
        }
        chrome.runtime.sendMessage({ type: "DATA_CHANGED" }).catch(() => undefined);
        return owners;
      })()
        .then((ownerIds) => sendResponse({ ok: true, ownerIds }))
        .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
      return true;
    }

    if (message?.type !== "E2E_CONTEXT_MENU_CLICK") return false;

    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId)) {
      sendResponse({ ok: false, error: "E2E tab id is missing." });
      return false;
    }

    void captureFromContextMenu(tabId).then(sendResponse);
    return true;
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "DUOLINGO_VISIBLE_SESSION_TERMINATED") {
    void stageAutoTerminatedDuolingoSession(message, sender.tab?.id)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (message?.type === "COLLECT_ACTIVE_SELECTION") {
    void (async () => {
      try {
        const tabId = await activeTabId();
        const settings = await loadSettings();
        await collectFromTab(
          tabId,
          message.language ?? captureLanguageForSettings(settings),
          settings.sourceUrlMode,
        );
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: errorMessage(error) });
      }
    })();

    return true;
  }

  if (message?.type === "DUOLINGO_SCAN_ACTIVE") {
    void scanVisibleDuolingo()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (message?.type === "DUOLINGO_START_ACTIVE_SESSION") {
    void startVisibleDuolingoSession()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (message?.type === "DUOLINGO_GET_ACTIVE_SESSION_STATUS") {
    void visibleDuolingoSessionStatus()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (message?.type === "DUOLINGO_STOP_ACTIVE_SESSION") {
    void stopVisibleDuolingoSession()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (message?.type === "EDIT_STAGED_CANDIDATE") {
    void editStagedCandidate(String(message.candidateId ?? ""), message.changes ?? {})
      .then((batch) => sendResponse({
        ok: true,
        batch,
        staged: stagedSummary(batch),
      }))
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (message?.type === "DISCARD_STAGED_CANDIDATES") {
    void discardStagedCandidates(
      Array.isArray(message.candidateIds) ? message.candidateIds.map(String) : [],
    )
      .then((batch) => sendResponse({
        ok: true,
        batch,
        staged: stagedSummary(batch),
      }))
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (message?.type === "COMMIT_STAGED_CANDIDATES") {
    const candidateIds = Array.isArray(message.candidateIds)
      ? message.candidateIds.map(String)
      : [];
    const resolutions = message.resolutions && typeof message.resolutions === "object"
      ? message.resolutions as Record<string, string>
      : undefined;
    void commitStagedCandidates({ candidateIds, resolutions })
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (message?.type === "GET_STAGED_BATCH") {
    void currentStagedBatch()
      .then((batch) => sendResponse({ ok: true, batch }))
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  return false;
});
