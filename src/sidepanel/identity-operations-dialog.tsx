import React, { useEffect, useMemo, useRef, useState } from "react";
import type { CollectedItem } from "../core/types";
import type { MergePreview, SplitPreview } from "../storage/repository";

function useDialogKeyboard(
  busy: boolean,
  onClose: () => void,
): React.RefObject<HTMLElement | null> {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const heading = dialogRef.current?.querySelector<HTMLElement>("[data-dialog-heading]");
    heading?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const heading = dialogRef.current.querySelector<HTMLElement>("[data-dialog-heading]");
      if (
        event.shiftKey
        && (document.activeElement === first || document.activeElement === heading)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    dialog.addEventListener("keydown", onKeyDown);
    return () => dialog.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  return dialogRef;
}

function searchableText(item: CollectedItem): string {
  return [
    item.lexicalUnit.canonicalText,
    item.lexicalUnit.note,
    item.lexicalUnit.language,
    ...item.occurrences.flatMap((occurrence) => [
      occurrence.surfaceText,
      occurrence.context,
      occurrence.source.title,
    ]),
  ].join(" ").toLocaleLowerCase();
}

function BindingSummary({
  preview,
  side,
}: {
  preview: MergePreview;
  side: "source" | "target";
}): React.ReactElement {
  const summary = preview[side];
  const binding = summary.exportBinding;
  const legacyNoteId = summary.lexicalUnit.ankiNoteId;

  if (!binding && legacyNoteId === undefined) {
    return <span className="setting-help">Anki: unbound</span>;
  }

  return (
    <span className="setting-help">
      Anki: {binding?.state ?? "legacy exported"}
      {binding?.profileId ? ` · profile ${binding.profileId}` : ""}
      {binding?.deckName ? ` · deck ${binding.deckName}` : ""}
      {binding?.modelName ? ` · note type ${binding.modelName}` : ""}
      {(binding?.ankiNoteId ?? legacyNoteId) !== undefined
        ? ` · note ${binding?.ankiNoteId ?? legacyNoteId}`
        : ""}
    </span>
  );
}

function MergeUnitPreview({
  preview,
  side,
}: {
  preview: MergePreview;
  side: "source" | "target";
}): React.ReactElement {
  const summary = preview[side];
  const unit = summary.lexicalUnit;

  return (
    <section className="identity-unit-preview" aria-label={side === "source" ? "Current lexical unit" : "Merge candidate"}>
      <div className="identity-unit-head">
        <strong dir="auto">{unit.canonicalText}</strong>
        <span className="pill">{unit.status}</span>
      </div>
      <span className="setting-help">{unit.language} · Collector ID {unit.id}</span>
      {unit.note && <p className="learner-note">{unit.note}</p>}
      <BindingSummary preview={preview} side={side} />
      <div className="identity-occurrence-list">
        {summary.occurrences.map((occurrence) => (
          <div className="occurrence-row" key={occurrence.id}>
            <span>
              <strong dir="auto">{occurrence.surfaceText}</strong>
              {summary.selectedOccurrenceId === occurrence.id ? " · selected evidence" : ""}
            </span>
            {occurrence.context && occurrence.context !== occurrence.surfaceText && (
              <span dir="auto">{occurrence.context}</span>
            )}
            <span className="setting-help">
              {occurrence.source.title || occurrence.source.adapter} · {occurrence.id}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

interface MergeDialogProps {
  source: CollectedItem;
  candidates: CollectedItem[];
  preview: MergePreview | null;
  canonicalText: string;
  note: string;
  error: string;
  busy: boolean;
  onChooseCandidate(id: string): void;
  onCanonicalTextChange(value: string): void;
  onNoteChange(value: string): void;
  onCancel(): void;
  onConfirm(): void;
}

export function MergeLexicalUnitDialog({
  source,
  candidates,
  preview,
  canonicalText,
  note,
  error,
  busy,
  onChooseCandidate,
  onCanonicalTextChange,
  onNoteChange,
  onCancel,
  onConfirm,
}: MergeDialogProps): React.ReactElement {
  const dialogRef = useDialogKeyboard(busy, onCancel);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleCandidates = useMemo(
    () => candidates.filter((item) =>
      !normalizedQuery || searchableText(item).includes(normalizedQuery)
    ),
    [candidates, normalizedQuery],
  );

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="product-dialog identity-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-dialog-title"
        onKeyDown={(event) => event.stopPropagation()}
      >
        <h2 id="merge-dialog-title" data-dialog-heading tabIndex={-1}>Merge lexical units</h2>
        <p className="setting-help">
          Merge is an explicit identity operation. Review both units and the surviving Collector ID before confirming.
        </p>

        <div className="identity-source-summary">
          <span>Current unit</span>
          <strong dir="auto">{source.lexicalUnit.canonicalText}</strong>
          <span className="setting-help">{source.lexicalUnit.id}</span>
        </div>

        <label>
          Find merge candidate
          <input
            autoComplete="off"
            value={query}
            placeholder="Canonical form, note, or context"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="identity-candidate-list" aria-label="Merge candidates">
          {visibleCandidates.length === 0 && (
            <div className="empty compact-empty">No matching lexical units in this language.</div>
          )}
          {visibleCandidates.map((item) => {
            const selected = preview?.target.lexicalUnit.id === item.lexicalUnit.id;
            return (
              <button
                type="button"
                className={selected ? "identity-candidate selected" : "identity-candidate"}
                key={item.lexicalUnit.id}
                disabled={busy}
                aria-pressed={selected}
                onClick={() => onChooseCandidate(item.lexicalUnit.id)}
              >
                <strong dir="auto">{item.lexicalUnit.canonicalText}</strong>
                <span>{item.occurrences.length} occurrence{item.occurrences.length === 1 ? "" : "s"} · {item.lexicalUnit.status}</span>
                {item.lexicalUnit.note && <span>{item.lexicalUnit.note}</span>}
              </button>
            );
          })}
        </div>

        {preview && (
          <>
            <div className="identity-preview-grid">
              <MergeUnitPreview preview={preview} side="source" />
              <MergeUnitPreview preview={preview} side="target" />
            </div>
            <div className="identity-survivor" role="status" aria-live="polite">
              <strong>Surviving Collector ID</strong>
              <code>{preview.survivingLexicalUnitId}</code>
              <span>{preview.resultingOccurrenceCount} occurrences will belong to the survivor.</span>
            </div>

            {preview.blocked ? (
              <div className="proposal-warning identity-conflict" role="alert">
                {preview.conflictReason ?? "This merge is blocked by an identity conflict."}
              </div>
            ) : (
              <>
                <label>
                  Merged canonical form
                  <input
                    value={canonicalText}
                    onChange={(event) => onCanonicalTextChange(event.target.value)}
                  />
                </label>
                <label>
                  Learner note
                  <textarea
                    rows={3}
                    value={note}
                    placeholder="Choose the meaning/note deliberately; notes are never concatenated automatically."
                    onChange={(event) => onNoteChange(event.target.value)}
                  />
                </label>
                <p className="setting-help">
                  The surviving unit returns to Inbox. Collector does not change Anki during this merge.
                </p>
              </>
            )}
          </>
        )}

        {error && <div className="proposal-warning" role="alert">{error}</div>}

        <div className="dialog-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="danger"
            disabled={busy || !preview || preview.blocked || !canonicalText.trim()}
            onClick={onConfirm}
          >
            Confirm merge
          </button>
        </div>
      </section>
    </div>
  );
}

interface SplitDialogProps {
  source: CollectedItem;
  selectedOccurrenceIds: string[];
  canonicalText: string;
  note: string;
  preview: SplitPreview | null;
  error: string;
  busy: boolean;
  onToggleOccurrence(id: string, selected: boolean): void;
  onCanonicalTextChange(value: string): void;
  onNoteChange(value: string): void;
  onReview(): void;
  onCancel(): void;
  onConfirm(): void;
}

export function SplitLexicalUnitDialog({
  source,
  selectedOccurrenceIds,
  canonicalText,
  note,
  preview,
  error,
  busy,
  onToggleOccurrence,
  onCanonicalTextChange,
  onNoteChange,
  onReview,
  onCancel,
  onConfirm,
}: SplitDialogProps): React.ReactElement {
  const dialogRef = useDialogKeyboard(busy, onCancel);
  const selected = new Set(selectedOccurrenceIds);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="product-dialog identity-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="split-dialog-title"
        onKeyDown={(event) => event.stopPropagation()}
      >
        <h2 id="split-dialog-title" data-dialog-heading tabIndex={-1}>Split occurrences</h2>
        <p className="setting-help">
          Move selected evidence into a new lexical identity. The original Collector ID and any Anki binding stay with the original unit.
        </p>

        <div className="identity-source-summary">
          <span>Original unit</span>
          <strong dir="auto">{source.lexicalUnit.canonicalText}</strong>
          <span className="setting-help">{source.lexicalUnit.id}</span>
        </div>

        <fieldset className="identity-occurrence-picker">
          <legend>Occurrences to move</legend>
          {source.occurrences.map((occurrence) => (
            <label className="identity-occurrence-choice" key={occurrence.id}>
              <input
                type="checkbox"
                checked={selected.has(occurrence.id)}
                disabled={busy}
                onChange={(event) => onToggleOccurrence(occurrence.id, event.target.checked)}
              />
              <span>
                <strong dir="auto">{occurrence.surfaceText}</strong>
                {occurrence.context && occurrence.context !== occurrence.surfaceText && (
                  <span dir="auto">{occurrence.context}</span>
                )}
                <span className="setting-help">{occurrence.source.title || occurrence.source.adapter}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <label>
          New unit canonical form
          <input
            value={canonicalText}
            onChange={(event) => onCanonicalTextChange(event.target.value)}
          />
          <span className="setting-help">Keeping the same canonical form as the original is valid.</span>
        </label>
        <label>
          New unit learner note
          <textarea
            rows={3}
            value={note}
            placeholder="Optional meaning/note for the new identity"
            onChange={(event) => onNoteChange(event.target.value)}
          />
        </label>

        <button
          type="button"
          className="ghost"
          disabled={
            busy
            || selectedOccurrenceIds.length === 0
            || selectedOccurrenceIds.length >= source.occurrences.length
            || !canonicalText.trim()
          }
          onClick={onReview}
        >
          Review split
        </button>

        {preview && (
          <div className="identity-survivor" role="status" aria-live="polite">
            <strong>Split preview</strong>
            <span>
              Original keeps {preview.remainingOccurrenceCount} occurrence{preview.remainingOccurrenceCount === 1 ? "" : "s"} and its Collector/Anki identity.
            </span>
            <span>
              New unit receives {preview.newOccurrenceCount} occurrence{preview.newOccurrenceCount === 1 ? "" : "s"}, a new Collector ID, no Anki binding, and Inbox status.
            </span>
            <span>Both affected units require review. No Anki mutation occurs now.</span>
          </div>
        )}

        {error && <div className="proposal-warning" role="alert">{error}</div>}

        <div className="dialog-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="danger"
            disabled={busy || !preview}
            onClick={onConfirm}
          >
            Confirm split
          </button>
        </div>
      </section>
    </div>
  );
}
