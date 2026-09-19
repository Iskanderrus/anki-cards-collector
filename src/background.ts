declare const __COLLECTOR_E2E__: boolean;

import { BatchCapturePipeline, type BatchCaptureEvidence, type BatchCaptureResult } from "./capture/batch";
import { sanitizeSourceUrl } from "./capture/source-url";
import type { CaptureDraft, SourceUrlMode } from "./core/types";
import { loadSettings } from "./settings";
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
let visibleSessionTabId: number | null = null;

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
  language: string,
  sourceUrlMode: SourceUrlMode,
  requestedBatchId: string,
) {
  const existing = batchPipeline.getActiveBatch();
  const prepared = evidence.map((candidate) => ({
    ...candidate,
    language: language.trim().toLowerCase() || "und",
    source: {
      ...candidate.source,
      url: sanitizeSourceUrl(candidate.source.url, sourceUrlMode),
    },
  }));

  const merged = [
    ...(existing?.candidates.map(asEvidence) ?? []),
    ...prepared,
  ];
  const result = await batchPipeline.stageBatch(
    existing?.batchId ?? requestedBatchId,
    merged,
  );

  return stagedSummary(result);
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
    language: settings.defaultLanguage,
  }) as VisibleContentResponse;

  if (!response?.ok) throw new Error(response?.error ?? "Could not scan visible Duolingo material.");

  const evidence = response.evidence ?? [];
  const staged = await stageVisibleEvidence(
    evidence,
    settings.defaultLanguage,
    settings.sourceUrlMode,
    `duolingo-visible-${crypto.randomUUID()}`,
  );

  return { foundCount: evidence.length, staged };
}

async function startVisibleDuolingoSession(): Promise<{
  status: VisibleSessionStatus;
  staged: ReturnType<typeof stagedSummary>;
}> {
  if (visibleSessionTabId !== null) {
    try {
      const existing = await chrome.tabs.sendMessage(visibleSessionTabId, {
        type: "DUOLINGO_GET_VISIBLE_SESSION_STATUS",
      }) as VisibleContentResponse;
      if (existing?.ok && existing.status?.active) {
        return {
          status: existing.status,
          staged: stagedSummary(batchPipeline.getActiveBatch()),
        };
      }
    } catch {
      visibleSessionTabId = null;
    }
  }

  const tabId = await activeTabId();
  const settings = await loadSettings();
  await injectContentScript(tabId);

  const response = await chrome.tabs.sendMessage(tabId, {
    type: "DUOLINGO_START_VISIBLE_SESSION",
    language: settings.defaultLanguage,
  }) as VisibleContentResponse;

  if (!response?.ok || !response.status) {
    throw new Error(response?.ok ? "Could not start Duolingo backfill." : response?.error);
  }

  visibleSessionTabId = tabId;
  return {
    status: response.status,
    staged: stagedSummary(batchPipeline.getActiveBatch()),
  };
}

async function visibleDuolingoSessionStatus(): Promise<{
  supported: boolean;
  status: VisibleSessionStatus;
  staged: ReturnType<typeof stagedSummary>;
}> {
  if (visibleSessionTabId !== null) {
    try {
      const response = await chrome.tabs.sendMessage(visibleSessionTabId, {
        type: "DUOLINGO_GET_VISIBLE_SESSION_STATUS",
      }) as VisibleContentResponse;

      if (response?.ok && response.status?.active) {
        return {
          supported: true,
          status: response.status,
          staged: stagedSummary(batchPipeline.getActiveBatch()),
        };
      }
    } catch {
      // The originating tab navigated, closed, or destroyed the injected content context.
    }
    visibleSessionTabId = null;
  }

  const tabId = await activeTabId();

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "DUOLINGO_GET_VISIBLE_SESSION_STATUS",
    }) as VisibleContentResponse;

    if (!response?.ok || !response.status) {
      return {
        supported: false,
        status: { active: false, candidateCount: 0 },
        staged: stagedSummary(batchPipeline.getActiveBatch()),
      };
    }

    if (response.status.active) visibleSessionTabId = tabId;
    return {
      supported: response.supported === true,
      status: response.status,
      staged: stagedSummary(batchPipeline.getActiveBatch()),
    };
  } catch {
    return {
      supported: false,
      status: { active: false, candidateCount: 0 },
      staged: stagedSummary(batchPipeline.getActiveBatch()),
    };
  }
}

async function stopVisibleDuolingoSession(): Promise<{
  foundCount: number;
  status: VisibleSessionStatus;
  staged: ReturnType<typeof stagedSummary>;
}> {
  const tabId = visibleSessionTabId ?? await activeTabId();
  const settings = await loadSettings();

  const response = await chrome.tabs.sendMessage(tabId, {
    type: "DUOLINGO_STOP_VISIBLE_SESSION",
  }) as VisibleContentResponse;

  if (!response?.ok) throw new Error(response?.error ?? "Could not stop Duolingo backfill.");
  visibleSessionTabId = null;

  const evidence = response.evidence ?? [];
  const staged = await stageVisibleEvidence(
    evidence,
    settings.defaultLanguage,
    settings.sourceUrlMode,
    response.sessionId ? `duolingo-session-${response.sessionId}` : `duolingo-session-${crypto.randomUUID()}`,
  );

  return {
    foundCount: evidence.length,
    status: response.status ?? { active: false, candidateCount: evidence.length },
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
    await collectFromTab(tabId, settings.defaultLanguage, settings.sourceUrlMode);
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "COLLECT_ACTIVE_SELECTION") {
    void (async () => {
      try {
        const tabId = await activeTabId();
        const settings = await loadSettings();
        await collectFromTab(
          tabId,
          message.language ?? settings.defaultLanguage,
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

  if (message?.type === "GET_STAGED_BATCH") {
    sendResponse({ ok: true, batch: batchPipeline.getActiveBatch() });
    return false;
  }

  return false;
});
