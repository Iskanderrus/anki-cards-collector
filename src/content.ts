declare const __COLLECTOR_E2E__: boolean;

import { adapterFor } from "./capture/adapters";
import type { BatchCaptureEvidence } from "./capture/batch";
import {
  collectVisibleDuolingoEvidence,
  duolingoEvidenceFingerprint,
  supportsDuolingoVisibleBackfill,
} from "./capture/duolingo-backfill";

declare global {
  interface Window {
    __ankiCardsCollectorLoaded?: boolean;
  }
}

interface VisibleSessionStatus {
  active: boolean;
  sessionId?: string;
  candidateCount: number;
  startedAt?: string;
}

interface ActiveVisibleSession {
  id: string;
  language: string;
  startedAt: string;
  evidence: Map<string, BatchCaptureEvidence>;
  observer: MutationObserver;
  scanTimer: number | null;
  allowFixture: boolean;
  terminating: boolean;
}

let visibleSession: ActiveVisibleSession | null = null;

function allowDuolingoFixture(): boolean {
  return __COLLECTOR_E2E__
    && document.documentElement.dataset.collectorDuolingoFixture === "true";
}

function sessionStatus(): VisibleSessionStatus {
  if (!visibleSession) return { active: false, candidateCount: 0 };

  return {
    active: true,
    sessionId: visibleSession.id,
    candidateCount: visibleSession.evidence.size,
    startedAt: visibleSession.startedAt,
  };
}

function sessionEvidence(): BatchCaptureEvidence[] {
  return visibleSession ? [...visibleSession.evidence.values()] : [];
}

function notifySessionStatus(): void {
  chrome.runtime.sendMessage({
    type: "DUOLINGO_VISIBLE_SESSION_UPDATED",
    status: sessionStatus(),
    evidence: sessionEvidence(),
  }).catch(() => undefined);
}

async function autoTerminateVisibleSession(
  session: ActiveVisibleSession,
  reason: "unsupported-context" | "pagehide",
  collectFinalEvidence = false,
): Promise<void> {
  if (visibleSession !== session || session.terminating) return;

  session.terminating = true;
  session.observer.disconnect();
  if (session.scanTimer !== null) {
    window.clearTimeout(session.scanTimer);
    session.scanTimer = null;
  }

  if (collectFinalEvidence) {
    void accumulateVisibleEvidence(session);
  }

  const evidence = [...session.evidence.values()];
  const response = await chrome.runtime.sendMessage({
    type: "DUOLINGO_VISIBLE_SESSION_TERMINATED",
    sessionId: session.id,
    evidence,
    reason,
  }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "Could not preserve Duolingo session evidence.",
  })) as { ok?: boolean; error?: string };

  if (!response?.ok) {
    // Keep the evidence reachable so the user can still explicitly Stop & stage
    // if an automatic handoff fails while the content context remains alive.
    session.terminating = false;
    notifySessionStatus();
    return;
  }

  if (visibleSession === session) {
    visibleSession = null;
  }
  notifySessionStatus();
}

function accumulateVisibleEvidence(session: ActiveVisibleSession): boolean {
  if (!supportsDuolingoVisibleBackfill(document, window.location, session.allowFixture)) {
    return false;
  }

  const before = session.evidence.size;
  const evidence = collectVisibleDuolingoEvidence(
    document,
    window.location,
    document.title,
    session.language,
    new Date().toISOString(),
    session.allowFixture,
  );

  for (const candidate of evidence) {
    session.evidence.set(duolingoEvidenceFingerprint(candidate), candidate);
  }

  if (session.evidence.size !== before) notifySessionStatus();
  return true;
}

function scheduleSessionScan(session: ActiveVisibleSession): void {
  if (session.scanTimer !== null) window.clearTimeout(session.scanTimer);
  session.scanTimer = window.setTimeout(() => {
    session.scanTimer = null;
    if (visibleSession !== session) return;

    if (!accumulateVisibleEvidence(session)) {
      void autoTerminateVisibleSession(session, "unsupported-context");
    }
  }, 80);
}

function startVisibleSession(language: string): VisibleSessionStatus {
  if (visibleSession) return sessionStatus();

  const allowFixture = allowDuolingoFixture();
  if (!supportsDuolingoVisibleBackfill(document, window.location, allowFixture)) {
    throw new Error("Open a Duolingo lesson or review page first.");
  }

  const session: ActiveVisibleSession = {
    id: crypto.randomUUID(),
    language: language.trim().toLowerCase() || "und",
    startedAt: new Date().toISOString(),
    evidence: new Map(),
    observer: new MutationObserver(() => scheduleSessionScan(session)),
    scanTimer: null,
    allowFixture,
    terminating: false,
  };

  visibleSession = session;
  accumulateVisibleEvidence(session);
  session.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["hidden", "aria-hidden", "class", "style", "data-test"],
  });
  notifySessionStatus();
  return sessionStatus();
}

function prepareStopVisibleSession(): { status: VisibleSessionStatus; evidence: BatchCaptureEvidence[]; sessionId?: string } {
  const session = visibleSession;
  if (!session) return { status: sessionStatus(), evidence: [] };

  if (!session.terminating) {
    session.terminating = true;
    session.observer.disconnect();
    if (session.scanTimer !== null) {
      window.clearTimeout(session.scanTimer);
      session.scanTimer = null;
    }

    if (supportsDuolingoVisibleBackfill(document, window.location, session.allowFixture)) {
      void accumulateVisibleEvidence(session);
    }
  }

  const evidence = [...session.evidence.values()];
  return {
    status: { active: false, candidateCount: evidence.length },
    evidence,
    sessionId: session.id,
  };
}

function confirmStopVisibleSession(sessionId: string): VisibleSessionStatus {
  const session = visibleSession;
  if (!session || session.id !== sessionId) return sessionStatus();

  session.observer.disconnect();
  if (session.scanTimer !== null) window.clearTimeout(session.scanTimer);
  visibleSession = null;
  notifySessionStatus();
  return { active: false, candidateCount: session.evidence.size };
}

function cancelVisibleSession(sessionId: string): VisibleSessionStatus {
  const session = visibleSession;
  if (!session || session.id !== sessionId) return sessionStatus();

  session.observer.disconnect();
  if (session.scanTimer !== null) window.clearTimeout(session.scanTimer);
  visibleSession = null;
  notifySessionStatus();
  return { active: false, candidateCount: 0 };
}

if (!window.__ankiCardsCollectorLoaded) {
  window.__ankiCardsCollectorLoaded = true;

  window.addEventListener("pagehide", () => {
    if (!visibleSession) return;
    void autoTerminateVisibleSession(visibleSession, "pagehide", true);
  }, { once: true });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message?.type === "CAPTURE_SELECTION") {
        const selection = window.getSelection();
        const draft = selection
          ? adapterFor(window.location).capture(selection, window.location, document.title)
          : null;

        sendResponse({ ok: true, draft });
        return false;
      }

      if (message?.type === "DUOLINGO_SCAN_VISIBLE") {
        const allowFixture = allowDuolingoFixture();
        if (!supportsDuolingoVisibleBackfill(document, window.location, allowFixture)) {
          sendResponse({ ok: false, error: "Open a Duolingo lesson or review page first." });
          return false;
        }

        const evidence = collectVisibleDuolingoEvidence(
          document,
          window.location,
          document.title,
          String(message.language ?? "und"),
          new Date().toISOString(),
          allowFixture,
        );
        sendResponse({ ok: true, evidence });
        return false;
      }

      if (message?.type === "DUOLINGO_START_VISIBLE_SESSION") {
        sendResponse({
          ok: true,
          status: startVisibleSession(String(message.language ?? "und")),
          evidence: sessionEvidence(),
        });
        return false;
      }

      if (message?.type === "DUOLINGO_GET_VISIBLE_SESSION_STATUS") {
        sendResponse({
          ok: true,
          supported: supportsDuolingoVisibleBackfill(document, window.location, allowDuolingoFixture()),
          status: sessionStatus(),
          evidence: sessionEvidence(),
        });
        return false;
      }

      if (message?.type === "DUOLINGO_PREPARE_STOP_VISIBLE_SESSION") {
        sendResponse({ ok: true, ...prepareStopVisibleSession() });
        return false;
      }

      if (message?.type === "DUOLINGO_CONFIRM_STOP_VISIBLE_SESSION") {
        sendResponse({
          ok: true,
          status: confirmStopVisibleSession(String(message.sessionId ?? "")),
        });
        return false;
      }

      if (message?.type === "DUOLINGO_CANCEL_VISIBLE_SESSION") {
        sendResponse({
          ok: true,
          status: cancelVisibleSession(String(message.sessionId ?? "")),
        });
        return false;
      }
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Duolingo backfill failed.",
      });
      return false;
    }

    return false;
  });
}
