import React, { useEffect, useMemo, useState } from "react";
import type {
  BatchCandidateEdit,
  BatchCaptureCandidate,
  BatchCommitSummary,
  CandidateDisposition,
} from "../capture/batch";

const DISPOSITION_LABELS: Record<CandidateDisposition, string> = {
  new: "New",
  "already-represented": "Existing",
  "repeated-evidence": "More evidence",
  "needs-review": "Needs review",
};

const DISPOSITION_HELP: Record<CandidateDisposition, string> = {
  new: "No matching lexical unit or observed form is currently represented in the corpus.",
  "already-represented": "The same persisted evidence is already represented. Importing it is a no-op.",
  "repeated-evidence": "An existing lexical unit owns this form, but this context/source evidence is new.",
  "needs-review": "More than one existing lexical unit could own this evidence. Choose the intended owner before import.",
};

type DispositionFilter = "all" | CandidateDisposition;

export interface StagedImportResult {
  summary: BatchCommitSummary;
  warning?: string;
}

interface StagedReviewProps {
  candidates: BatchCaptureCandidate[];
  ownerLabels: Record<string, string>;
  busy: boolean;
  importResult: StagedImportResult | null;
  onEdit(candidateId: string, changes: BatchCandidateEdit): Promise<void>;
  onCommit(candidateIds: string[], resolutions: Record<string, string>): Promise<void>;
  onDiscard(candidateIds: string[]): Promise<void>;
  onBack(): void;
}

interface EditDraft {
  surfaceText: string;
  language: string;
  context: string;
}

function sourceLabel(candidate: BatchCaptureCandidate): string {
  const source = candidate.source;
  let location = source.title || source.url || "source";
  try {
    location = new URL(source.url).hostname || location;
  } catch {
    // Keep the human-readable title/URL fallback.
  }
  return [source.adapter, location].filter(Boolean).join(" · ");
}

function normalizedSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function StagedReview({
  candidates,
  ownerLabels,
  busy,
  importResult,
  onEdit,
  onCommit,
  onDiscard,
  onBack,
}: StagedReviewProps): React.ReactElement {
  const [filter, setFilter] = useState<DispositionFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(candidates[0]?.id ?? null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});

  const visibleCandidates = useMemo(() => {
    const search = normalizedSearch(query);
    return candidates.filter((candidate) => {
      if (filter !== "all" && candidate.disposition !== filter) return false;
      if (!search) return true;
      const haystack = [
        candidate.surfaceText,
        candidate.context,
        candidate.language,
        candidate.source.adapter,
        candidate.source.title,
        candidate.source.url,
        DISPOSITION_LABELS[candidate.disposition],
      ].join("\n").toLocaleLowerCase();
      return haystack.includes(search);
    });
  }, [candidates, filter, query]);

  const candidateById = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.id, candidate])),
    [candidates],
  );
  const activeCandidate = activeId ? candidateById.get(activeId) ?? null : null;
  const selectedCandidates = candidates.filter((candidate) => selectedIds.has(candidate.id));
  const unresolvedSelected = selectedCandidates.filter(
    (candidate) => candidate.disposition === "needs-review"
      && !candidate.matchingLexicalUnitIds.includes(resolutions[candidate.id] ?? ""),
  );

  useEffect(() => {
    const knownIds = new Set(candidates.map((candidate) => candidate.id));
    setSelectedIds((current) => new Set([...current].filter((id) => knownIds.has(id))));
    setResolutions((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => knownIds.has(id)),
    ));
    setActiveId((current) => {
      if (current && knownIds.has(current)) return current;
      return candidates[0]?.id ?? null;
    });
  }, [candidates]);

  useEffect(() => {
    if (activeId && visibleCandidates.some((candidate) => candidate.id === activeId)) return;
    const nextActiveId = visibleCandidates[0]?.id ?? null;
    if (nextActiveId === activeId) return;
    setActiveId(nextActiveId);
    setEditingId(null);
    setEditDraft(null);
  }, [activeId, visibleCandidates]);

  function setSelected(candidateId: string, selected: boolean): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(candidateId);
      else next.delete(candidateId);
      return next;
    });
  }

  function selectVisible(disposition: CandidateDisposition): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const candidate of visibleCandidates) {
        if (candidate.disposition === disposition) next.add(candidate.id);
      }
      return next;
    });
  }

  function focusVisible(index: number): void {
    const candidate = visibleCandidates[index];
    if (!candidate) return;
    setActiveId(candidate.id);
    requestAnimationFrame(() => {
      const selector = `[data-staged-id="${CSS.escape(candidate.id)}"]`;
      const row = document.querySelector<HTMLElement>(selector);
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: "nearest" });
    });
  }

  function onReviewKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (
      target.isContentEditable
      || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)
    ) {
      return;
    }

    const key = event.key.toLowerCase();
    const currentIndex = Math.max(
      0,
      visibleCandidates.findIndex((candidate) => candidate.id === activeId),
    );

    if (key === "j" || event.key === "ArrowDown") {
      event.preventDefault();
      focusVisible(Math.min(visibleCandidates.length - 1, currentIndex + 1));
      return;
    }
    if (key === "k" || event.key === "ArrowUp") {
      event.preventDefault();
      focusVisible(Math.max(0, currentIndex - 1));
      return;
    }
    if (event.key === " " && activeCandidate) {
      event.preventDefault();
      setSelected(activeCandidate.id, !selectedIds.has(activeCandidate.id));
      return;
    }
    if (event.key === "Enter" && activeCandidate) {
      event.preventDefault();
      document.querySelector<HTMLElement>("[data-staged-detail]")?.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onBack();
    }
  }

  function beginEdit(candidate: BatchCaptureCandidate): void {
    setActiveId(candidate.id);
    setEditingId(candidate.id);
    setEditDraft({
      surfaceText: candidate.surfaceText,
      language: candidate.language,
      context: candidate.context,
    });
  }

  async function saveEdit(candidateId: string): Promise<void> {
    if (!editDraft) return;
    try {
      await onEdit(candidateId, editDraft);
      setEditingId(null);
      setEditDraft(null);
    } catch {
      // Parent owns the visible error surface; keep the draft available for correction/retry.
    }
  }

  async function importSelected(): Promise<void> {
    if (selectedIds.size === 0 || unresolvedSelected.length > 0) return;
    const ids = candidates
      .filter((candidate) => selectedIds.has(candidate.id))
      .map((candidate) => candidate.id);
    const selectedResolutions = Object.fromEntries(
      ids
        .filter((id) => resolutions[id])
        .map((id) => [id, resolutions[id]!]),
    );
    try {
      await onCommit(ids, selectedResolutions);
    } catch {
      // Selection intentionally survives a failed commit for safe retry.
    }
  }

  async function discardSelected(): Promise<void> {
    if (selectedIds.size === 0) return;
    const ids = candidates
      .filter((candidate) => selectedIds.has(candidate.id))
      .map((candidate) => candidate.id);
    const confirmed = window.confirm(
      `Remove ${ids.length} selected candidate${ids.length === 1 ? "" : "s"} from this staged batch? This does not change normal corpus material and does not create a permanent suppression rule.`,
    );
    if (!confirmed) return;
    try {
      await onDiscard(ids);
    } catch {
      // Parent owns the visible error surface; selection remains available for retry.
    }
  }

  return (
    <section
      className="staged-review"
      aria-labelledby="staged-review-title"
      onKeyDown={onReviewKeyDown}
    >
      <div className="staged-review-head">
        <div>
          <h2 id="staged-review-title">Backfill review</h2>
          <p>
            Captured evidence only. Nothing here is Ready or exported until it enters the normal
            corpus and completes ordinary review.
          </p>
        </div>
        <button className="ghost" type="button" onClick={onBack}>Back to queue</button>
      </div>

      <div className="staged-filter-grid">
        <label>
          Search staged evidence
          <input
            className="staged-review-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Text, context, language, source…"
          />
        </label>
        <label>
          Disposition
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as DispositionFilter)}
          >
            <option value="all">All dispositions</option>
            <option value="new">New</option>
            <option value="already-represented">Existing</option>
            <option value="repeated-evidence">More evidence</option>
            <option value="needs-review">Needs review</option>
          </select>
        </label>
      </div>

      <div className="staged-scope-summary" role="status" aria-live="polite">
        <span>{visibleCandidates.length} visible of {candidates.length} staged</span>
        <span>{selectedIds.size} selected across the full staged batch</span>
      </div>

      <div className="staged-bulk-actions" aria-label="Visible candidate selection actions">
        <button
          type="button"
          disabled={busy || visibleCandidates.every((candidate) => candidate.disposition !== "new")}
          onClick={() => selectVisible("new")}
        >
          Select visible New
        </button>
        <button
          type="button"
          disabled={busy || visibleCandidates.every(
            (candidate) => candidate.disposition !== "repeated-evidence",
          )}
          onClick={() => selectVisible("repeated-evidence")}
        >
          Select visible More evidence
        </button>
        <button
          className="ghost"
          type="button"
          disabled={busy || selectedIds.size === 0}
          onClick={() => setSelectedIds(new Set())}
        >
          Clear all selection
        </button>
      </div>

      {candidates.length === 0 ? (
        <div className="empty staged-empty">
          No staged evidence. Run an explicit visible backfill scan or session from Queue first.
        </div>
      ) : visibleCandidates.length === 0 ? (
        <div className="empty staged-empty">
          No candidates match this search/filter. Clear the filter to show the staged batch again.
        </div>
      ) : (
        <div className="staged-review-list" role="list" aria-label="Staged candidates">
          {visibleCandidates.map((candidate) => {
            const selected = selectedIds.has(candidate.id);
            const active = candidate.id === activeId;
            return (
              <article
                className="staged-review-row"
                key={candidate.id}
                role="listitem"
                tabIndex={active ? 0 : -1}
                data-staged-id={candidate.id}
                data-active={active ? "true" : "false"}
                data-selected={selected ? "true" : "false"}
                aria-label={`${candidate.surfaceText}, ${DISPOSITION_LABELS[candidate.disposition]}, ${selected ? "selected" : "not selected"}`}
                onFocus={() => setActiveId(candidate.id)}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  aria-label={`Select ${candidate.surfaceText}`}
                  onChange={(event) => setSelected(candidate.id, event.target.checked)}
                />
                <button
                  className="staged-row-open"
                  type="button"
                  onClick={() => setActiveId(candidate.id)}
                  aria-label={`Inspect ${candidate.surfaceText}`}
                >
                  <span className="staged-row-head">
                    <strong dir="auto">{candidate.surfaceText}</strong>
                    <span
                      className={`pill staged-disposition disposition-${candidate.disposition}`}
                      aria-label={`Disposition: ${DISPOSITION_LABELS[candidate.disposition]}`}
                    >
                      {DISPOSITION_LABELS[candidate.disposition]}
                    </span>
                  </span>
                  <span className="staged-row-meta">
                    {candidate.language} · {sourceLabel(candidate)}
                    {candidate.duplicateCount > 1 ? ` · seen ${candidate.duplicateCount}×` : ""}
                  </span>
                  {candidate.context && candidate.context !== candidate.surfaceText && (
                    <span className="staged-row-context" dir="auto">{candidate.context}</span>
                  )}
                </button>
              </article>
            );
          })}
        </div>
      )}

      {activeCandidate && (
        <section
          className="staged-detail"
          data-staged-detail
          tabIndex={-1}
          aria-labelledby="staged-detail-title"
        >
          <div className="staged-detail-head">
            <div>
              <strong id="staged-detail-title" dir="auto">{activeCandidate.surfaceText}</strong>
              <span>{DISPOSITION_LABELS[activeCandidate.disposition]}</span>
            </div>
            {editingId !== activeCandidate.id && (
              <button
                type="button"
                disabled={busy}
                onClick={() => beginEdit(activeCandidate)}
              >
                Edit evidence
              </button>
            )}
          </div>

          <p className="staged-disposition-help">
            {DISPOSITION_HELP[activeCandidate.disposition]}
          </p>

          {editingId === activeCandidate.id && editDraft ? (
            <div className="staged-editor" aria-label="Edit staged evidence">
              <label>
                Observed text
                <input
                  dir="auto"
                  value={editDraft.surfaceText}
                  onChange={(event) => setEditDraft({
                    ...editDraft,
                    surfaceText: event.target.value,
                  })}
                />
              </label>
              <label>
                Language code
                <input
                  value={editDraft.language}
                  onChange={(event) => setEditDraft({
                    ...editDraft,
                    language: event.target.value,
                  })}
                />
              </label>
              <label>
                Context
                <textarea
                  dir="auto"
                  rows={4}
                  value={editDraft.context}
                  onChange={(event) => setEditDraft({
                    ...editDraft,
                    context: event.target.value,
                  })}
                />
              </label>
              <div className="toolbar">
                <button
                  className="primary"
                  type="button"
                  disabled={busy || !editDraft.surfaceText.trim()}
                  onClick={() => void saveEdit(activeCandidate.id)}
                >
                  Save evidence correction
                </button>
                <button
                  className="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEditingId(null);
                    setEditDraft(null);
                  }}
                >
                  Cancel
                </button>
              </div>
              <p className="setting-help">
                This corrects captured evidence only. Canonical lexical editing still happens after
                import in the normal corpus review.
              </p>
            </div>
          ) : (
            <dl className="staged-evidence-details">
              <div>
                <dt>Language</dt>
                <dd>{activeCandidate.language}</dd>
              </div>
              <div>
                <dt>Context</dt>
                <dd dir="auto">{activeCandidate.context || "—"}</dd>
              </div>
              <div>
                <dt>Source/session evidence</dt>
                <dd>{sourceLabel(activeCandidate)}</dd>
              </div>
            </dl>
          )}

          {activeCandidate.disposition === "needs-review" && (
            <label className="staged-resolution">
              Existing lexical unit for this evidence
              <select
                value={resolutions[activeCandidate.id] ?? ""}
                onChange={(event) => setResolutions((current) => ({
                  ...current,
                  [activeCandidate.id]: event.target.value,
                }))}
              >
                <option value="">Choose an existing owner before import…</option>
                {activeCandidate.matchingLexicalUnitIds.map((ownerId) => (
                  <option value={ownerId} key={ownerId}>
                    {ownerLabels[ownerId] ?? ownerId}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>
      )}

      {unresolvedSelected.length > 0 && (
        <div className="notice staged-resolution-warning" role="status">
          Resolve {unresolvedSelected.length} selected Needs review candidate
          {unresolvedSelected.length === 1 ? "" : "s"} before importing.
        </div>
      )}

      <div className="staged-import-actions">
        <button
          className="primary"
          type="button"
          disabled={busy || selectedIds.size === 0 || unresolvedSelected.length > 0}
          onClick={() => void importSelected()}
        >
          Import {selectedIds.size || ""} selected to Inbox
        </button>
        <button
          className="ghost danger"
          type="button"
          disabled={busy || selectedIds.size === 0}
          onClick={() => void discardSelected()}
        >
          Discard selected from batch
        </button>
      </div>

      {importResult && (
        <div className="staged-import-result" role="status" aria-live="polite">
          <strong>Import result</strong>
          <span>{importResult.summary.newUnits} new lexical unit{importResult.summary.newUnits === 1 ? "" : "s"}</span>
          <span>{importResult.summary.evidenceAdded} occurrence{importResult.summary.evidenceAdded === 1 ? "" : "s"} added to existing units</span>
          <span>{importResult.summary.unchanged} already represented / no-op</span>
          <span>{importResult.summary.needsReview} still require manual review</span>
          {importResult.warning && <span>{importResult.warning}</span>}
        </div>
      )}

      <div className="shortcuts staged-shortcuts" aria-label="Staged review keyboard shortcuts">
        <span><kbd>J</kbd>/<kbd>↓</kbd> next visible</span>
        <span><kbd>K</kbd>/<kbd>↑</kbd> previous visible</span>
        <span><kbd>Space</kbd> select</span>
        <span><kbd>Enter</kbd> inspect</span>
        <span><kbd>Esc</kbd> queue</span>
      </div>
    </section>
  );
}
