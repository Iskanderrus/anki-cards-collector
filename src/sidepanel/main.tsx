import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { BackupDocument } from "../backup/format";
import { parseBackup, serializeBackup } from "../backup/format";
import type {
  CollectedItem,
  CollectorSettings,
  ExportBinding,
  ExportProfile,
  Occurrence,
  ReviewStatus,
  SourceUrlMode,
} from "../core/types";
import type { RestorePreview } from "../storage/repository";
import { repository } from "../storage/repository";
import {
  DEFAULT_SETTINGS,
  ensureManagedProfileForDeck,
  loadSettings,
  mergeSettingsForRestore,
  saveSettings,
} from "../settings";
import { exportBatch, type ExportItemOutcome, type ExportProgress } from "../anki/batch";
import { AnkiClient } from "../anki/client";
import { resolveExportRoute } from "../anki/routing";
import { moveExportedNote } from "../anki/move";
import {
  AnkiCatalogService,
  type AnkiCatalogRefreshResult,
  type AnkiCatalogSnapshot,
  type AnkiModelDetail,
  type AnkiModelInspectionResult,
} from "../anki/catalog";
import { ChromeAnkiCatalogCache } from "../anki/catalog-cache";
import { downloadText, toTsv } from "../anki/export";
import { proposeLearningCard } from "../learning/policy";

type CatalogUiState =
  | { kind: "idle" }
  | { kind: "loading"; snapshot: AnkiCatalogSnapshot | null }
  | AnkiCatalogRefreshResult;

type ModelUiState =
  | { kind: "idle" }
  | { kind: "loading"; detail: AnkiModelDetail | null }
  | AnkiModelInspectionResult;


interface VisibleSessionStatus {
  active: boolean;
  sessionId?: string;
  candidateCount: number;
  startedAt?: string;
}

interface StagedBatchSummary {
  batchId: string | null;
  candidateCount: number;
  dispositions: {
    new: number;
    "already-represented": number;
    "repeated-evidence": number;
    "needs-review": number;
  };
}

interface BackfillUiState {
  supported: boolean;
  status: VisibleSessionStatus;
  staged: StagedBatchSummary;
}

interface StagedCandidatePreview {
  id: string;
  surfaceText: string;
  context: string;
  language: string;
  disposition: "new" | "already-represented" | "repeated-evidence" | "needs-review";
  duplicateCount: number;
}

interface LiveSessionCandidate {
  surfaceText: string;
  context: string;
  language: string;
  capturedAt: string;
}

const DUOLINGO_OPTIONAL_ORIGINS = [
  "https://duolingo.com/*",
  "https://*.duolingo.com/*",
];

async function ensureDuolingoPageAccess(): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  if (manifest.host_permissions?.includes("http://127.0.0.1/*")) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.startsWith("http://127.0.0.1:")) return;
  }

  const granted = await chrome.permissions.request({
    origins: DUOLINGO_OPTIONAL_ORIGINS,
  });

  if (!granted) {
    throw new Error(
      "Duolingo page access was not granted. Collector needs this optional permission to scan visible lesson content.",
    );
  }
}

const EMPTY_STAGED_BATCH: StagedBatchSummary = {
  batchId: null,
  candidateCount: 0,
  dispositions: {
    new: 0,
    "already-represented": 0,
    "repeated-evidence": 0,
    "needs-review": 0,
  },
};

interface EditDraft {
  canonicalText: string;
  language: string;
  surfaceText: string;
  context: string;
  note: string;
  occurrenceId?: string;
}

function latestOccurrence(item: CollectedItem) {
  return item.occurrences.at(-1);
}

function sourceLabel(occurrence: Occurrence | undefined): string {
  const source = occurrence?.source;
  if (!source) return "unknown source";
  try {
    return new URL(source.url).hostname;
  } catch {
    return source.title || "source";
  }
}

function App(): React.ReactElement {
  const [items, setItems] = useState<CollectedItem[]>([]);
  const [settings, setSettings] = useState<CollectorSettings>(DEFAULT_SETTINGS);
  const [exportBindings, setExportBindings] = useState<Record<string, ExportBinding>>({});
  const [routeLanguage, setRouteLanguage] = useState("");
  const [routeDeckName, setRouteDeckName] = useState("");
  const [pendingMoveDecks, setPendingMoveDecks] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [pendingBackup, setPendingBackup] = useState<BackupDocument | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportOutcomes, setExportOutcomes] = useState<Record<string, ExportItemOutcome>>({});
  const [catalogState, setCatalogState] = useState<CatalogUiState>({ kind: "idle" });
  const [modelState, setModelState] = useState<ModelUiState>({ kind: "idle" });
  const [backfill, setBackfill] = useState<BackfillUiState>({
    supported: false,
    status: { active: false, candidateCount: 0 },
    staged: EMPTY_STAGED_BATCH,
  });
  const [stagedCandidates, setStagedCandidates] = useState<StagedCandidatePreview[]>([]);
  const [liveSessionCandidates, setLiveSessionCandidates] = useState<LiveSessionCandidate[]>([]);
  const settingsMutationQueue = useRef<Promise<void>>(Promise.resolve());
  const catalogService = useMemo(
    () => new AnkiCatalogService(
      new AnkiClient(),
      () => new Date(),
      new ChromeAnkiCatalogCache(),
    ),
    [],
  );

  const load = useCallback(async () => {
    const [loadedItems, loadedBindings, loadedSettings] = await Promise.all([
      repository.list(),
      repository.listExportBindings(),
      loadSettings(),
    ]);

    const completedBindings = await Promise.all(loadedBindings.map(async (binding) => {
      if (
        binding.ankiNoteId === undefined
        || (binding.deckName !== undefined && binding.modelName !== undefined)
      ) {
        return binding;
      }

      const profile = loadedSettings.exportProfiles.find(
        (candidate) => candidate.id === binding.profileId,
      );
      if (!profile) return binding;

      const completed: ExportBinding = {
        ...binding,
        deckName: binding.deckName ?? profile.deckName,
        modelName: binding.modelName ?? profile.modelName,
      };
      await repository.setExportBinding(completed);
      return completed;
    }));

    setItems(loadedItems);
    setExportBindings(Object.fromEntries(
      completedBindings.map((binding) => [binding.lexicalUnitId, binding]),
    ));
    setActiveId((current) => (
      current && loadedItems.some((item) => item.lexicalUnit.id === current)
        ? current
        : loadedItems[0]?.lexicalUnit.id ?? null
    ));
    setSettings(loadedSettings);
    const fallback = loadedSettings.exportProfiles.find(
      (profile) => profile.id === loadedSettings.fallbackProfileId,
    );
    setRouteDeckName((current) => current || fallback?.deckName || "");
  }, []);

  useEffect(() => {
    void load();
    void refreshBackfillStatus();
    void refreshStagedCandidates();
    const listener = (message: unknown) => {
      const event = message as {
        type?: string;
        error?: string;
        status?: VisibleSessionStatus;
        evidence?: LiveSessionCandidate[];
        staged?: StagedBatchSummary;
        foundCount?: number;
        reason?: string;
      };
      if (event.type === "DATA_CHANGED") void load();
      if (event.type === "CAPTURE_ERROR") setError(event.error ?? "Capture failed.");
      if (event.type === "DUOLINGO_VISIBLE_SESSION_UPDATED" && event.status) {
        setBackfill((current) => ({ ...current, status: event.status! }));
        setLiveSessionCandidates(event.status.active ? event.evidence ?? [] : []);
      }
      if (event.type === "DUOLINGO_VISIBLE_SESSION_AUTO_STAGED" && event.staged) {
        setBackfill({
          supported: false,
          status: { active: false, candidateCount: event.foundCount ?? 0 },
          staged: event.staged,
        });
        setLiveSessionCandidates([]);
        setNotice(
          `Backfill session ended after leaving the supported Duolingo study context. ${event.foundCount ?? 0} session candidate${event.foundCount === 1 ? "" : "s"} preserved; ${event.staged.candidateCount} candidate${event.staged.candidateCount === 1 ? "" : "s"} are staged for review.`,
        );
        void refreshStagedCandidates();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [load]);

  useEffect(() => {
    if (!backfill.status.active) return undefined;

    const timer = window.setInterval(() => {
      void refreshBackfillStatus();
    }, 750);

    return () => window.clearInterval(timer);
  }, [backfill.status.active]);

  const counts = useMemo(() => ({
    inbox: items.filter((item) => item.lexicalUnit.status === "inbox").length,
    ready: items.filter((item) => item.lexicalUnit.status === "ready").length,
  }), [items]);

  async function capture(): Promise<void> {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "COLLECT_ACTIVE_SELECTION",
        language: settings.defaultLanguage,
      }) as { ok: boolean; error?: string };

      if (!response.ok) throw new Error(response.error ?? "Capture failed.");
      setNotice("Collected. Review it before exporting.");
      await load();
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : "Capture failed.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshStagedCandidates(): Promise<void> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_STAGED_BATCH",
      }) as {
        ok: boolean;
        batch?: { candidates?: StagedCandidatePreview[] } | null;
      };

      if (!response.ok) return;
      setStagedCandidates(response.batch?.candidates ?? []);
    } catch {
      // Staging is ephemeral; an unavailable service-worker snapshot simply has no preview.
      setStagedCandidates([]);
    }
  }

  async function refreshBackfillStatus(): Promise<void> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "DUOLINGO_GET_ACTIVE_SESSION_STATUS",
      }) as {
        ok: boolean;
        supported?: boolean;
        status?: VisibleSessionStatus;
        staged?: StagedBatchSummary;
        liveEvidence?: LiveSessionCandidate[];
      };

      if (!response.ok) return;
      const status = response.status ?? { active: false, candidateCount: 0 };
      setBackfill({
        supported: response.supported === true,
        status,
        staged: response.staged ?? EMPTY_STAGED_BATCH,
      });
      setLiveSessionCandidates(status.active ? response.liveEvidence ?? [] : []);
    } catch {
      setBackfill((current) => ({
        ...current,
        supported: false,
        status: { active: false, candidateCount: 0 },
      }));
      setLiveSessionCandidates([]);
    }
  }

  async function scanVisibleDuolingo(): Promise<void> {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      await ensureDuolingoPageAccess();

      const response = await chrome.runtime.sendMessage({
        type: "DUOLINGO_SCAN_ACTIVE",
      }) as {
        ok: boolean;
        error?: string;
        foundCount?: number;
        staged?: StagedBatchSummary;
      };

      if (!response.ok) throw new Error(response.error ?? "Duolingo scan failed.");
      const staged = response.staged ?? EMPTY_STAGED_BATCH;
      setBackfill((current) => ({
        ...current,
        supported: true,
        staged,
      }));
      setNotice(
        `Scanned ${response.foundCount ?? 0} visible candidate${response.foundCount === 1 ? "" : "s"}. ${staged.candidateCount} candidate${staged.candidateCount === 1 ? "" : "s"} staged for review; nothing was added to Anki.`,
      );
      await refreshStagedCandidates();
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Duolingo scan failed.");
    } finally {
      setBusy(false);
    }
  }

  async function startDuolingoSession(): Promise<void> {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      await ensureDuolingoPageAccess();

      const response = await chrome.runtime.sendMessage({
        type: "DUOLINGO_START_ACTIVE_SESSION",
      }) as {
        ok: boolean;
        error?: string;
        status?: VisibleSessionStatus;
        staged?: StagedBatchSummary;
        liveEvidence?: LiveSessionCandidate[];
      };

      if (!response.ok || !response.status) {
        throw new Error(response.error ?? "Could not start Duolingo backfill.");
      }

      setBackfill({
        supported: true,
        status: response.status,
        staged: response.staged ?? backfill.staged,
      });
      setLiveSessionCandidates(response.liveEvidence ?? []);
      setNotice("Duolingo backfill session started. Move through the lesson manually; Collector will only observe visible study material.");
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : "Could not start Duolingo backfill.");
    } finally {
      setBusy(false);
    }
  }

  async function stopDuolingoSession(): Promise<void> {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "DUOLINGO_STOP_ACTIVE_SESSION",
      }) as {
        ok: boolean;
        error?: string;
        foundCount?: number;
        status?: VisibleSessionStatus;
        staged?: StagedBatchSummary;
      };

      if (!response.ok) throw new Error(response.error ?? "Could not stop Duolingo backfill.");
      const staged = response.staged ?? backfill.staged;
      setBackfill({
        supported: true,
        status: response.status ?? { active: false, candidateCount: 0 },
        staged,
      });
      setLiveSessionCandidates([]);
      setNotice(
        `Backfill session stopped. ${response.foundCount ?? 0} session candidate${response.foundCount === 1 ? "" : "s"} observed; ${staged.candidateCount} candidate${staged.candidateCount === 1 ? "" : "s"} are staged for review.`,
      );
      await refreshStagedCandidates();
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : "Could not stop Duolingo backfill.");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(id: string, status: ReviewStatus): Promise<void> {
    if (status === "ready") {
      const item = items.find((candidate) => candidate.lexicalUnit.id === id);
      if (item) {
        const proposal = proposeLearningCard(item);
        if (!proposal.recommended) {
          setError(proposal.warning ?? "Review this item before marking it ready.");
          return;
        }
      }
    }

    setError("");
    await repository.setStatus(id, status);
    await load();
  }

  function beginEdit(item: CollectedItem): void {
    const proposal = proposeLearningCard(item);
    const occurrence = proposal.occurrenceSelection?.occurrence ?? latestOccurrence(item);
    setEditingId(item.lexicalUnit.id);
    setEditDraft({
      canonicalText: item.lexicalUnit.canonicalText,
      language: item.lexicalUnit.language,
      surfaceText: occurrence?.surfaceText ?? item.lexicalUnit.canonicalText,
      context: occurrence?.context ?? "",
      note: item.lexicalUnit.note,
      occurrenceId: occurrence?.id,
    });
    setError("");
    setNotice("");
  }

  function cancelEdit(): void {
    setEditingId(null);
    setEditDraft(null);
  }

  async function saveEdit(id: string): Promise<void> {
    if (!editDraft) return;

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const updated = await repository.update(id, editDraft);
      const proposal = proposeLearningCard(updated);
      if (updated.lexicalUnit.status === "ready" && !proposal.recommended) {
        await repository.setStatus(updated.lexicalUnit.id, "inbox");
        setNotice("Changes saved. This item returned to the inbox because its learning target needs review.");
      } else if (updated.lexicalUnit.id !== id) {
        setNotice("Changes saved. Matching observed forms were consolidated under one canonical unit; review it before export.");
      } else if (updated.lexicalUnit.status === "inbox") {
        setNotice("Changes saved. Review the updated learning target before marking it ready again.");
      } else {
        setNotice("Changes saved. The next Anki export will update the same Collector note.");
      }
      cancelEdit();
      await load();
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : "Could not save changes.");
    } finally {
      setBusy(false);
    }
  }

  async function exportToAnki(): Promise<void> {
    const ready = items.filter((item) => item.lexicalUnit.status === "ready");
    if (!ready.length) {
      setError("Mark at least one item as ready first.");
      return;
    }

    const blocked = ready.filter((item) => !proposeLearningCard(item).recommended);
    if (blocked.length > 0) {
      setError(`${blocked.length} ready item${blocked.length === 1 ? "" : "s"} need review before export.`);
      return;
    }

    const legacyCustom = ready.filter((item) => {
      const binding = exportBindings[item.lexicalUnit.id];
      if (!binding?.ankiNoteId) return false;
      const profile = settings.exportProfiles.find(
        (candidate) => candidate.id === binding.profileId,
      );
      return profile?.mode === "mapped-user-model";
    });
    const exportable = ready.filter((item) => !legacyCustom.includes(item));

    if (exportable.length === 0) {
      setError(
        legacyCustom.length > 0
          ? "These existing Anki cards use custom note types. Collector will leave them unchanged for now."
          : "No Ready cards can be exported.",
      );
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    setExportOutcomes({});
    setExportProgress({ completed: 0, total: exportable.length });

    try {
      const report = await exportBatch(
        exportable,
        settings,
        new Map(Object.values(exportBindings).map((binding) => [binding.lexicalUnitId, binding])),
        new AnkiClient(),
        (binding) => repository.setExportBinding(binding),
        setExportProgress,
      );

      setExportOutcomes(Object.fromEntries(
        report.results.map((result) => [result.id, result]),
      ));

      const parts = [`${report.exported} exported`];
      if (legacyCustom.length > 0) {
        parts.push(`${legacyCustom.length} existing custom-card${legacyCustom.length === 1 ? "" : "s"} skipped`);
      }
      if (report.failed > 0) parts.push(`${report.failed} failed`);
      if (report.warnings > 0) parts.push(`${report.warnings} local warning${report.warnings === 1 ? "" : "s"}`);

      if (report.failed > 0 || report.warnings > 0) {
        setError(`Anki export finished: ${parts.join(", ")}. See the affected cards below.`);
      } else {
        setNotice(`Anki export finished: ${parts.join(", ")}.`);
      }
      await load();
    } catch (ankiError) {
      setError(
        ankiError instanceof Error
          ? `${ankiError.message} Is Anki running with AnkiConnect enabled?`
          : "Anki export failed.",
      );
    } finally {
      setExportProgress(null);
      setBusy(false);
    }
  }

  async function persistSettings(
    update: (current: CollectorSettings) => CollectorSettings,
  ): Promise<CollectorSettings> {
    let resolved = settings;
    const run = settingsMutationQueue.current.then(async () => {
      const current = await loadSettings();
      await saveSettings(update(current));
      resolved = await loadSettings();
      setSettings(resolved);
      const fallback = resolved.exportProfiles.find(
        (profile) => profile.id === resolved.fallbackProfileId,
      );
      setRouteDeckName((selected) => selected || fallback?.deckName || "");
    });

    settingsMutationQueue.current = run.then(() => undefined, () => undefined);
    await run;
    return resolved;
  }

  function resolvedRoute(item: CollectedItem) {
    try {
      return resolveExportRoute(
        item,
        settings,
        exportBindings[item.lexicalUnit.id] ?? null,
      );
    } catch {
      return null;
    }
  }

  function liveDeckId(deckName: string): string | undefined {
    const deck = currentCatalogSnapshot()?.decks.find((candidate) => candidate.name === deckName);
    return deck ? String(deck.id) : undefined;
  }

  async function ensureDeckProfile(deckName: string): Promise<ExportProfile> {
    let resolved: ExportProfile | null = null;
    await persistSettings((current) => {
      const ensured = ensureManagedProfileForDeck(
        current,
        deckName,
        liveDeckId(deckName),
      );
      resolved = ensured.profile;
      return ensured.settings;
    });
    if (!resolved) throw new Error("Could not prepare this Anki deck.");
    return resolved;
  }

  async function setItemDeckOverride(
    lexicalUnitId: string,
    deckName: string,
  ): Promise<void> {
    if (deckName === "auto") {
      const existing = exportBindings[lexicalUnitId];
      if (existing?.ankiNoteId !== undefined) {
        setError("This card is already in Anki. Use “Move to another deck…” instead.");
        return;
      }
      await repository.clearExportBinding(lexicalUnitId);
      setNotice("This card will follow its language deck again.");
      await load();
      return;
    }

    const profile = await ensureDeckProfile(deckName);
    const existing = exportBindings[lexicalUnitId];
    if (existing?.ankiNoteId !== undefined) {
      setPendingMoveDecks((current) => ({ ...current, [lexicalUnitId]: deckName }));
      return;
    }

    await repository.setExportBinding({
      lexicalUnitId,
      profileId: profile.id,
      deckName: profile.deckName,
      modelName: profile.modelName,
    });
    setNotice(`This card will go to ${deckName}.`);
    await load();
  }

  async function moveExportedItem(
    item: CollectedItem,
    targetDeckName: string,
  ): Promise<void> {
    const binding = exportBindings[item.lexicalUnit.id];
    if (!binding?.ankiNoteId) {
      setError("This card has not been exported to Anki yet.");
      return;
    }

    const currentProfile = settings.exportProfiles.find(
      (profile) => profile.id === binding.profileId,
    );
    if (!currentProfile) {
      setError("Collector cannot find the saved destination for this Anki card.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const target = await ensureDeckProfile(targetDeckName);
      const movedBinding = await moveExportedNote(
        {
          lexicalUnitId: item.lexicalUnit.id,
          binding,
          currentProfile,
          targetProfile: target,
        },
        new AnkiClient(),
        (nextBinding) => repository.setExportBinding(nextBinding),
      );
      setPendingMoveDecks((current) => {
        const next = { ...current };
        delete next[item.lexicalUnit.id];
        return next;
      });
      setNotice(`Moved Anki note ${movedBinding.ankiNoteId} to ${movedBinding.deckName}.`);
      await load();
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Could not move the Anki card.");
    } finally {
      setBusy(false);
    }
  }

  async function createSavedDeck(deckName: string): Promise<void> {
    if (catalogState.kind !== "live") {
      setError("Refresh Anki first.");
      return;
    }
    if (catalogState.snapshot.decks.some((deck) => deck.name === deckName)) {
      setNotice(`${deckName} already exists in Anki.`);
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      await new AnkiClient().createDeck(deckName);
      setNotice(`Created Anki deck ${deckName}.`);
      await refreshAnkiCatalog();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create the Anki deck.");
    } finally {
      setBusy(false);
    }
  }

  async function setFallbackDeck(deckName: string): Promise<void> {
    await persistSettings((current) => {
      const ensured = ensureManagedProfileForDeck(
        current,
        deckName,
        liveDeckId(deckName),
      );
      return {
        ...ensured.settings,
        fallbackProfileId: ensured.profile.id,
      };
    });
    setNotice(`Other languages will go to ${deckName}.`);
  }

  async function setLanguageDeck(language: string, deckName: string): Promise<void> {
    await persistSettings((current) => {
      const ensured = ensureManagedProfileForDeck(
        current,
        deckName,
        liveDeckId(deckName),
      );
      return {
        ...ensured.settings,
        languageRoutes: [
          ...ensured.settings.languageRoutes.filter((route) => route.language !== language),
          { language, profileId: ensured.profile.id },
        ].sort((left, right) => left.language.localeCompare(right.language)),
      };
    });
    setNotice(`${language} cards will go to ${deckName}.`);
  }

  async function saveLanguageRoute(): Promise<void> {
    const language = routeLanguage.trim().toLowerCase();
    if (!language || language === "und") {
      setError("Enter a language code such as he, sr, or es.");
      return;
    }
    if (!routeDeckName) {
      setError("Choose an Anki deck.");
      return;
    }

    await setLanguageDeck(language, routeDeckName);
    setRouteLanguage("");
  }

  async function removeLanguageRoute(language: string): Promise<void> {
    await persistSettings((current) => ({
      ...current,
      languageRoutes: current.languageRoutes.filter((route) => route.language !== language),
    }));
    setNotice(`${language} will use the “Other languages” deck.`);
  }

  function currentCatalogSnapshot(): AnkiCatalogSnapshot | null {
    if (catalogState.kind === "idle" || catalogState.kind === "unavailable") return null;
    return catalogState.snapshot;
  }

  async function inspectAnkiModel(modelName: string): Promise<void> {
    if (!modelName) {
      setModelState({ kind: "idle" });
      return;
    }

    const previousDetail =
      modelState.kind === "idle" || modelState.kind === "unavailable"
        ? null
        : modelState.detail;
    setModelState({ kind: "loading", detail: previousDetail });

    const result = await catalogService.inspectModel(modelName);
    setModelState(result);
  }

  async function refreshAnkiCatalog(): Promise<void> {
    setCatalogState({
      kind: "loading",
      snapshot: catalogService.currentSnapshot(),
    });

    const result = await catalogService.refresh();
    setCatalogState(result);

    const fallbackProfile = settings.exportProfiles.find(
      (profile) => profile.id === settings.fallbackProfileId,
    );
    if (
      fallbackProfile
      && (result.kind === "live" || result.kind === "stale")
      && result.snapshot.models.some((model) => model.name === fallbackProfile.modelName)
    ) {
      await inspectAnkiModel(fallbackProfile.modelName);
    } else {
      setModelState({ kind: "idle" });
    }
  }

  function exportTsv(): void {
    const ready = items.filter(
      (item) => item.lexicalUnit.status === "ready" && proposeLearningCard(item).recommended,
    );
    downloadText("anki-cards-collector.tsv", toTsv(ready), "text/tab-separated-values;charset=utf-8");
  }

  function backupJson(): void {
    downloadText(
      "anki-cards-collector-backup.json",
      serializeBackup(items, settings, Object.values(exportBindings)),
      "application/json;charset=utf-8",
    );
  }

  async function previewBackupFile(file: File | undefined): Promise<void> {
    if (!file) return;

    setBusy(true);
    setError("");
    setNotice("");
    setPendingBackup(null);
    setRestorePreview(null);

    try {
      const backup = parseBackup(await file.text());
      const preview = await repository.previewRestore(backup);
      const settingsMerge = backup.settings
        ? mergeSettingsForRestore(settings, backup.settings, items.length > 0 || Object.keys(exportBindings).length > 0)
        : { settings, conflicts: [] };
      const combinedPreview = {
        ...preview,
        conflicts: [...preview.conflicts, ...settingsMerge.conflicts],
      };
      setPendingBackup(backup);
      setRestorePreview(combinedPreview);

      if (combinedPreview.conflicts.length > 0) {
        setError(
          `Backup has ${combinedPreview.conflicts.length} conflict${combinedPreview.conflicts.length === 1 ? "" : "s"} and cannot be restored yet.`,
        );
      } else {
        setNotice("Backup validated. Review the dry-run counts before restoring.");
      }
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : "Could not read backup.");
    } finally {
      setBusy(false);
    }
  }

  function clearRestorePreview(): void {
    setPendingBackup(null);
    setRestorePreview(null);
  }

  async function restorePendingBackup(): Promise<void> {
    if (!pendingBackup || !restorePreview || restorePreview.conflicts.length > 0) return;

    setBusy(true);
    setError("");
    setNotice("");

    const settingsMerge = pendingBackup.settings
      ? mergeSettingsForRestore(settings, pendingBackup.settings, items.length > 0 || Object.keys(exportBindings).length > 0)
      : { settings, conflicts: [] };
    if (settingsMerge.conflicts.length > 0) {
      setError("Backup routing configuration conflicts with current local settings.");
      setBusy(false);
      return;
    }

    const previousSettings = settings;
    let settingsChanged = false;

    try {
      if (pendingBackup.settings) {
        await saveSettings(settingsMerge.settings);
        settingsChanged = true;
      }

      const result = await repository.restoreBackup(pendingBackup);
      clearRestorePreview();
      await load();

      const changed =
        result.lexicalUnitsAdded +
        result.lexicalUnitsUpdated +
        result.occurrencesAdded +
        result.occurrencesUpdated +
        result.exportBindingsAdded;
      setNotice(
        changed === 0
          ? "Backup is already fully represented in the local corpus."
          : `Backup restored: ${result.lexicalUnitsAdded} items added, ${result.lexicalUnitsUpdated} updated, ${result.occurrencesAdded} occurrences added.`,
      );
    } catch (restoreError) {
      if (settingsChanged) {
        try {
          await saveSettings(previousSettings);
          setSettings(previousSettings);
        } catch {
          setError(
            "Backup restore failed and Collector could not restore the previous routing settings. Reopen Settings before exporting.",
          );
          return;
        }
      }
      setError(restoreError instanceof Error ? restoreError.message : "Backup restore failed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
    }

    function focusCard(id: string): void {
      setActiveId(id);
      requestAnimationFrame(() => {
        const selector = `[data-card-id="${CSS.escape(id)}"]`;
        const card = document.querySelector<HTMLElement>(selector);
        card?.focus({ preventScroll: true });
        card?.scrollIntoView({ block: "nearest" });
      });
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (busy || editingId !== null || isTypingTarget(event.target) || items.length === 0) return;

      const currentIndex = Math.max(
        0,
        items.findIndex((item) => item.lexicalUnit.id === activeId),
      );
      const key = event.key.toLowerCase();

      if (key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const next = Math.min(items.length - 1, currentIndex + 1);
        focusCard(items[next]!.lexicalUnit.id);
        return;
      }

      if (key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const previous = Math.max(0, currentIndex - 1);
        focusCard(items[previous]!.lexicalUnit.id);
        return;
      }

      const activeItem = items[currentIndex];
      if (!activeItem) return;

      if (key === "e") {
        event.preventDefault();
        beginEdit(activeItem);
        return;
      }

      const statusByKey: Partial<Record<string, ReviewStatus>> = {
        r: "ready",
        i: "inbox",
        a: "archived",
      };
      const nextStatus = statusByKey[key];
      if (nextStatus) {
        event.preventDefault();
        void changeStatus(activeItem.lexicalUnit.id, nextStatus);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeId, busy, editingId, items]);

  return (
    <main className="app">
      <header className="header">
        <h1>Anki Cards Collector</h1>
        <p>Keep the language worth remembering. Leave the rest on the page.</p>
      </header>

      <div className="toolbar">
        <button className="primary" disabled={busy} onClick={() => void capture()}>
          Collect selection
        </button>
        <button disabled={busy || counts.ready === 0} onClick={() => void exportToAnki()}>
          Send ready to Anki
        </button>
      </div>

      <section className="backfill-panel" aria-label="Duolingo visible backfill">
        <div className="toolbar backfill-toolbar">
          <button
            disabled={busy || backfill.status.active}
            onClick={() => void scanVisibleDuolingo()}
          >
            Scan visible Duolingo
          </button>
          {backfill.status.active ? (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void stopDuolingoSession()}
            >
              Stop & stage session
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => void startDuolingoSession()}
            >
              Start backfill session
            </button>
          )}
        </div>
        <div className="backfill-status" role="status" aria-live="polite">
          {backfill.status.active ? (
            <>
              <strong>Backfill active</strong>
              <span>
                {backfill.status.candidateCount} visible candidate{backfill.status.candidateCount === 1 ? "" : "s"} observed.
                Navigate manually; Collector does not answer or advance exercises.
              </span>
            </>
          ) : backfill.staged.candidateCount > 0 ? (
            <>
              <strong>{backfill.staged.candidateCount} staged candidate{backfill.staged.candidateCount === 1 ? "" : "s"}</strong>
              <span>Staged evidence is not yet in the corpus and cannot be sent to Anki until reviewed.</span>
            </>
          ) : (
            <span>Backfill is opt-in. On first use Chrome asks for Duolingo page access; collection still runs only when you scan or start a session.</span>
          )}
        </div>
        {backfill.status.active && liveSessionCandidates.length > 0 && (
          <details className="staged-preview live-session-preview" open>
            <summary>Live session evidence ({liveSessionCandidates.length})</summary>
            <div className="staged-preview-list">
              {liveSessionCandidates.map((candidate, index) => (
                <article
                  className="staged-candidate live-session-candidate"
                  key={`${candidate.language}\u0000${candidate.surfaceText}\u0000${candidate.context}\u0000${index}`}
                >
                  <div className="staged-candidate-head">
                    <strong className="staged-candidate-text" dir="auto">{candidate.surfaceText}</strong>
                    <span className="pill">live</span>
                  </div>
                  <div className="meta">{candidate.language}</div>
                  {candidate.context && candidate.context !== candidate.surfaceText && (
                    <div className="staged-candidate-context" dir="auto">{candidate.context}</div>
                  )}
                </article>
              ))}
            </div>
            <div className="setting-help">
              Live preview only. These candidates remain in the active tab until you stop and stage the session.
            </div>
          </details>
        )}
        {stagedCandidates.length > 0 && (
          <details className="staged-preview" open={!backfill.status.active && stagedCandidates.length <= 3}>
            <summary>{backfill.status.active ? "Previously staged evidence" : "Preview staged evidence"} ({stagedCandidates.length})</summary>
            <div className="staged-preview-list">
              {stagedCandidates.map((candidate) => (
                <article className="staged-candidate" key={candidate.id}>
                  <div className="staged-candidate-head">
                    <strong className="staged-candidate-text" dir="auto">{candidate.surfaceText}</strong>
                    <span className="pill">{candidate.disposition}</span>
                  </div>
                  <div className="meta">
                    {candidate.language}
                    {candidate.duplicateCount > 1 ? ` · seen ${candidate.duplicateCount}× in this batch` : ""}
                  </div>
                  {candidate.context && candidate.context !== candidate.surfaceText && (
                    <div className="staged-candidate-context" dir="auto">{candidate.context}</div>
                  )}
                </article>
              ))}
            </div>
            <div className="setting-help">
              Preview only. These items are still staged evidence, not corpus cards; review/import controls belong to ACCP-021.
            </div>
          </details>
        )}
      </section>

      <div className="summary">
        <span>{counts.inbox} to review</span>
        <span>{counts.ready} ready</span>
        <span>{items.length} unique total</span>
      </div>

      {notice && <div className="notice" role="status" aria-live="polite">{notice}</div>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {exportProgress && (
        <div className="export-progress" role="status" aria-live="polite">
          <div>
            Exporting {exportProgress.completed}/{exportProgress.total}
            {exportProgress.currentText ? ` · ${exportProgress.currentText}` : ""}
          </div>
          <progress
            value={exportProgress.completed}
            max={Math.max(1, exportProgress.total)}
            aria-label="Anki export progress"
          />
        </div>
      )}

      <div className="shortcuts" aria-label="Keyboard shortcuts">
        <span><kbd>J</kbd>/<kbd>↓</kbd> next</span>
        <span><kbd>K</kbd>/<kbd>↑</kbd> previous</span>
        <span><kbd>E</kbd> edit</span>
        <span><kbd>R</kbd> ready</span>
        <span><kbd>I</kbd> inbox</span>
        <span><kbd>A</kbd> archive</span>
      </div>

      <details className="settings">
        <summary>Settings & fallback exports</summary>
        <div className="settings-grid">
          <label>
            Language code
            <input
              value={settings.defaultLanguage}
              placeholder="es, sr, he…"
              onChange={(event) => {
                const defaultLanguage = event.target.value || "und";
                void persistSettings((current) => ({ ...current, defaultLanguage }));
              }}
            />
          </label>
          <div className="anki-catalog">
            <div className="anki-catalog-head">
              <div>
                <strong>Live Anki catalog</strong>
                <div className="setting-help">
                  Read-only discovery. Refreshing does not create decks, change note types, or update cards.
                </div>
              </div>
              <button
                className="ghost"
                type="button"
                disabled={catalogState.kind === "loading"}
                onClick={() => void refreshAnkiCatalog()}
              >
                {catalogState.kind === "loading" ? "Refreshing…" : "Refresh from Anki"}
              </button>
            </div>

            <div className="anki-catalog-status" role="status" aria-live="polite">
              {catalogState.kind === "idle" && "Not checked yet."}
              {catalogState.kind === "loading" && "Reading decks and note types from Anki…"}
              {catalogState.kind === "live" && (
                <>Connected · {catalogState.snapshot.decks.length} deck{catalogState.snapshot.decks.length === 1 ? "" : "s"} · {catalogState.snapshot.models.length} note type{catalogState.snapshot.models.length === 1 ? "" : "s"}</>
              )}
              {catalogState.kind === "stale" && (
                <>Showing the last successful catalog. Refresh failed: {catalogState.error}</>
              )}
              {catalogState.kind === "unavailable" && (
                <>Anki catalog unavailable: {catalogState.error}</>
              )}
            </div>
          </div>

          <div className="language-decks">
            <div className="anki-catalog-head">
              <div>
                <strong>Anki decks by language</strong>
                <div className="setting-help">
                  Choose where each language should go. New cards use Collector Basic automatically.
                </div>
              </div>
            </div>

            {settings.languageRoutes.map((route) => {
              const profile = settings.exportProfiles.find(
                (candidate) => candidate.id === route.profileId,
              );
              const deckName = profile?.deckName ?? "";
              const missing = catalogState.kind === "live"
                && deckName
                && !catalogState.snapshot.decks.some((deck) => deck.name === deckName);

              return (
                <div className="language-deck-row" key={route.language}>
                  <strong>{route.language}</strong>
                  <select
                    aria-label={`Anki deck for ${route.language}`}
                    value={deckName}
                    onChange={(event) => void setLanguageDeck(route.language, event.target.value)}
                  >
                    {missing && <option value={deckName}>{deckName} (missing)</option>}
                    {currentCatalogSnapshot()?.decks.map((deck) => (
                      <option key={String(deck.id)} value={deck.name}>{deck.name}</option>
                    ))}
                  </select>
                  <button className="ghost" type="button" onClick={() => void removeLanguageRoute(route.language)}>
                    Remove
                  </button>
                  {missing && (
                    <button
                      className="ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => void createSavedDeck(deckName)}
                    >
                      Create deck
                    </button>
                  )}
                </div>
              );
            })}

            <div className="language-deck-add">
              <input
                aria-label="New language code"
                value={routeLanguage}
                placeholder="he, sr, es…"
                onChange={(event) => setRouteLanguage(event.target.value)}
              />
              <select
                aria-label="Anki deck for new language"
                value={routeDeckName}
                onChange={(event) => setRouteDeckName(event.target.value)}
              >
                {!routeDeckName && <option value="">Choose deck…</option>}
                {currentCatalogSnapshot()?.decks.map((deck) => (
                  <option key={String(deck.id)} value={deck.name}>{deck.name}</option>
                ))}
              </select>
              <button type="button" disabled={busy || !routeDeckName} onClick={() => void saveLanguageRoute()}>
                Add language
              </button>
            </div>

            {(() => {
              const fallback = settings.exportProfiles.find(
                (profile) => profile.id === settings.fallbackProfileId,
              );
              const deckName = fallback?.deckName ?? "";
              const missing = catalogState.kind === "live"
                && deckName
                && !catalogState.snapshot.decks.some((deck) => deck.name === deckName);

              return (
                <div className="language-deck-row fallback-deck-row">
                  <strong>Other</strong>
                  <select
                    aria-label="Anki deck for other languages"
                    value={deckName}
                    onChange={(event) => void setFallbackDeck(event.target.value)}
                  >
                    {missing && <option value={deckName}>{deckName} (missing)</option>}
                    {currentCatalogSnapshot()?.decks.map((deck) => (
                      <option key={String(deck.id)} value={deck.name}>{deck.name}</option>
                    ))}
                  </select>
                  {missing && (
                    <button
                      className="ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => void createSavedDeck(deckName)}
                    >
                      Create deck
                    </button>
                  )}
                </div>
              );
            })()}
          </div>

          {modelState.kind !== "idle" && (
            <div className="anki-model-inspector" aria-live="polite">
              {modelState.kind === "loading" && <span>Inspecting note type…</span>}
              {modelState.kind === "unavailable" && (
                <span>Could not inspect this note type: {modelState.error}</span>
              )}
              {(modelState.kind === "live" || modelState.kind === "stale") && (
                <>
                  <strong>{modelState.detail.name}</strong>
                  {modelState.kind === "stale" && (
                    <span className="setting-help">Showing cached metadata: {modelState.error}</span>
                  )}
                  <span><strong>Fields:</strong> {modelState.detail.fields.join(", ") || "none"}</span>
                  <span>
                    <strong>Templates:</strong>{" "}
                    {modelState.detail.templates.map((template) => template.name).join(", ") || "none"}
                  </span>
                  <span>
                    <strong>Styling:</strong>{" "}
                    {modelState.detail.css.length > 0
                      ? `${modelState.detail.css.length} CSS characters detected`
                      : "no CSS returned"}
                  </span>
                </>
              )}
            </div>
          )}
          <label>
            Source URL retention
            <select
              value={settings.sourceUrlMode}
              onChange={(event) => {
                const sourceUrlMode = event.target.value as SourceUrlMode;
                void persistSettings((current) => ({ ...current, sourceUrlMode }));
              }}
            >
              <option value="sanitized">Origin + path only (default)</option>
              <option value="query">Keep non-tracking query parameters</option>
              <option value="none">Do not store source URL</option>
            </select>
            <span className="setting-help">
              Credentials and fragments are never stored. Tracking parameters are removed in every retained mode.
            </span>
          </label>
          <div className="toolbar">
            <button className="ghost" disabled={busy} onClick={exportTsv}>Download ready as TSV</button>
            <button className="ghost" disabled={busy} onClick={backupJson}>Backup JSON</button>
          </div>

          <label>
            Restore JSON backup
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                void previewBackupFile(file);
              }}
            />
          </label>

          {restorePreview && (
            <div className="restore-preview">
              <strong>Restore preview</strong>
              <div className="restore-stats">
                <span>{restorePreview.lexicalUnitsAdded} items to add</span>
                <span>{restorePreview.lexicalUnitsUpdated} items to update</span>
                <span>{restorePreview.lexicalUnitsSkipped} items unchanged</span>
                <span>{restorePreview.occurrencesAdded} occurrences to add</span>
                <span>{restorePreview.occurrencesUpdated} occurrences to update</span>
                <span>{restorePreview.occurrencesSkipped} occurrences unchanged</span>
                <span>{restorePreview.exportBindingsAdded} export bindings to add</span>
                <span>{restorePreview.exportBindingsSkipped} export bindings unchanged</span>
              </div>

              {restorePreview.conflicts.length > 0 && (
                <ul className="conflict-list">
                  {restorePreview.conflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}
                </ul>
              )}

              <div className="toolbar">
                <button
                  className="primary"
                  disabled={busy || restorePreview.conflicts.length > 0}
                  onClick={() => void restorePendingBackup()}
                >
                  Restore backup
                </button>
                <button className="ghost" disabled={busy} onClick={clearRestorePreview}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </details>

      <section className="list" aria-label="Collected language">
        {items.length === 0 && (
          <div className="empty">
            Select something useful on a page, then click <strong>Collect selection</strong>.
          </div>
        )}

        {items.map((item) => {
          const unit = item.lexicalUnit;
          const editing = editingId === unit.id && editDraft !== null;
          const active = activeId === unit.id;
          const exportOutcome = exportOutcomes[unit.id];
          const proposal = proposeLearningCard(item);
          const selectedOccurrence = proposal.occurrenceSelection?.occurrence;
          const binding = exportBindings[unit.id];
          const route = resolvedRoute(item);
          const boundProfile = binding
            ? settings.exportProfiles.find((profile) => profile.id === binding.profileId)
            : null;
          const legacyCustomNote =
            binding?.ankiNoteId !== undefined && boundProfile?.mode === "mapped-user-model";
          const currentDeckName = route?.profile.deckName ?? binding?.deckName ?? "";
          const pendingMoveDeckName = pendingMoveDecks[unit.id] ?? currentDeckName;

          return (
            <article
              className="card"
              key={unit.id}
              data-card-id={unit.id}
              data-active={active ? "true" : "false"}
              tabIndex={active ? 0 : -1}
              aria-label={`Review ${unit.canonicalText}, ${unit.status}, ${item.occurrences.length} occurrence${item.occurrences.length === 1 ? "" : "s"}`}
              onFocus={() => setActiveId(unit.id)}
            >
              <div className="card-head">
                <div>
                  <div className="term">{unit.canonicalText}</div>
                  <div className="meta">
                    {unit.language} · {sourceLabel(selectedOccurrence)} · {item.occurrences.length} occurrence{item.occurrences.length === 1 ? "" : "s"}
                  </div>
                  {selectedOccurrence?.surfaceText &&
                    selectedOccurrence.surfaceText !== unit.canonicalText && (
                      <div className="meta">Observed: {selectedOccurrence.surfaceText}</div>
                    )}
                </div>
                <span className="pill">{unit.status}</span>
              </div>

              {editing ? (
                <form
                  className="editor"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveEdit(unit.id);
                  }}
                >
                  <label>
                    Canonical form
                    <input
                      autoFocus
                      value={editDraft.canonicalText}
                      onChange={(event) => setEditDraft({ ...editDraft, canonicalText: event.target.value })}
                    />
                  </label>
                  <label>
                    Observed form
                    <input
                      value={editDraft.surfaceText}
                      onChange={(event) => setEditDraft({ ...editDraft, surfaceText: event.target.value })}
                    />
                  </label>
                  <label>
                    Language code
                    <input
                      value={editDraft.language}
                      onChange={(event) => setEditDraft({ ...editDraft, language: event.target.value })}
                    />
                  </label>
                  <label>
                    Context
                    <textarea
                      rows={4}
                      value={editDraft.context}
                      onChange={(event) => setEditDraft({ ...editDraft, context: event.target.value })}
                    />
                  </label>
                  <label>
                    Learner note
                    <textarea
                      rows={3}
                      placeholder="Optional reminder, nuance, or usage note"
                      value={editDraft.note}
                      onChange={(event) => setEditDraft({ ...editDraft, note: event.target.value })}
                    />
                  </label>
                  <div className="card-actions">
                    <button className="primary" type="submit" disabled={busy}>Save</button>
                    <button className="ghost" type="button" disabled={busy} onClick={cancelEdit}>Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  {selectedOccurrence?.context && <p className="context">{selectedOccurrence.context}</p>}
                  {unit.note && <p className="learner-note">{unit.note}</p>}

                  <div className="export-destination compact">
                    <div className="export-destination-head">
                      <span>
                        <strong>Anki:</strong>{" "}
                        {currentDeckName || "choose a deck in Settings"}
                      </span>
                      {binding?.ankiNoteId !== undefined && (
                        <span className="setting-help">note {binding.ankiNoteId}</span>
                      )}
                    </div>

                    {legacyCustomNote ? (
                      <div className="legacy-note-warning" role="status">
                        This existing Anki card uses a custom note type. Collector will leave it unchanged for now.
                      </div>
                    ) : currentCatalogSnapshot() ? (
                      <details className="destination-change">
                        <summary>
                          {binding?.ankiNoteId !== undefined ? "Move to another deck…" : "Change deck…"}
                        </summary>

                        {binding?.ankiNoteId !== undefined ? (
                          <div className="destination-change-row">
                            <select
                              aria-label={`Move ${unit.canonicalText} to Anki deck`}
                              value={pendingMoveDeckName}
                              onChange={(event) => setPendingMoveDecks((current) => ({
                                ...current,
                                [unit.id]: event.target.value,
                              }))}
                            >
                              {!currentCatalogSnapshot()?.decks.some((deck) => deck.name === pendingMoveDeckName) && pendingMoveDeckName && (
                                <option value={pendingMoveDeckName}>{pendingMoveDeckName} (current)</option>
                              )}
                              {currentCatalogSnapshot()?.decks.map((deck) => (
                                <option key={String(deck.id)} value={deck.name}>{deck.name}</option>
                              ))}
                            </select>
                            {pendingMoveDeckName && pendingMoveDeckName !== currentDeckName && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void moveExportedItem(item, pendingMoveDeckName)}
                              >
                                Move
                              </button>
                            )}
                          </div>
                        ) : (
                          <select
                            aria-label={`Anki deck override for ${unit.canonicalText}`}
                            value={binding ? currentDeckName : "auto"}
                            onChange={(event) => void setItemDeckOverride(unit.id, event.target.value)}
                          >
                            <option value="auto">
                              Use language rule{route ? ` — ${route.profile.deckName}` : ""}
                            </option>
                            {currentCatalogSnapshot()?.decks.map((deck) => (
                              <option key={String(deck.id)} value={deck.name}>{deck.name}</option>
                            ))}
                          </select>
                        )}
                      </details>
                    ) : null}
                  </div>

                  {proposal.occurrenceSelection && item.occurrences.length > 1 && (
                    <div className="occurrence-selection">
                      <strong>
                        Using occurrence {proposal.occurrenceSelection.selectedNumber} of {proposal.occurrenceSelection.occurrenceCount}
                      </strong>
                      <span>{proposal.occurrenceSelection.reason}</span>
                    </div>
                  )}

                  <div className={`learning-proposal${proposal.recommended ? "" : " blocked"}`}>
                    <div className="proposal-head">
                      <strong>Suggested card</strong>
                      <span className="proposal-kinds">
                        <span className="pill">{proposal.unitKind}</span>
                        <span className="pill">{proposal.cardKind}</span>
                      </span>
                    </div>
                    <div className="proposal-field">
                      <span>Prompt</span>
                      <div>{proposal.prompt}</div>
                    </div>
                    <div className="proposal-field">
                      <span>Answer</span>
                      <div>{proposal.answer || "—"}</div>
                    </div>
                    <p className="proposal-why"><strong>Why:</strong> {proposal.reason}</p>
                    {proposal.warning && (
                      <div className="proposal-warning" role="status">{proposal.warning}</div>
                    )}
                  </div>

                  {exportOutcome?.kind === "failed" && (
                    <div className="item-export-result error" role="alert">
                      Anki export failed: {exportOutcome.error}
                    </div>
                  )}
                  {exportOutcome?.kind === "exported_untracked" && (
                    <div className="item-export-result warning" role="status">
                      {exportOutcome.error}
                    </div>
                  )}
                  {exportOutcome?.kind === "exported" && (
                    <div className="item-export-result success" role="status">
                      Exported to {exportOutcome.deckName}, Anki note {exportOutcome.noteId}.
                    </div>
                  )}

                  <div className="card-actions">
                    <button aria-keyshortcuts="E" disabled={busy} onClick={() => beginEdit(item)}>Edit</button>
                    {unit.status !== "ready" && (
                      <button
                        aria-keyshortcuts="R"
                        disabled={busy || !proposal.recommended}
                        title={proposal.recommended ? "Approve this card for export" : proposal.warning}
                        onClick={() => void changeStatus(unit.id, "ready")}
                      >
                        Ready
                      </button>
                    )}
                    {unit.status !== "inbox" && (
                      <button aria-keyshortcuts="I" disabled={busy} onClick={() => void changeStatus(unit.id, "inbox")}>Back to inbox</button>
                    )}
                    {unit.status !== "archived" && (
                      <button aria-keyshortcuts="A" className="ghost" disabled={busy} onClick={() => void changeStatus(unit.id, "archived")}>Archive</button>
                    )}
                    <button
                      className="ghost danger"
                      disabled={busy}
                      onClick={() => void repository.remove(unit.id).then(load)}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Side panel root element is missing.");

createRoot(root).render(<App />);
