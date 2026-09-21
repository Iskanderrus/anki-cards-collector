import React from "react";

export interface QueueEntry {
  id: string;
  canonicalText: string;
  language: string;
  status: string;
  occurrenceCount: number;
  context: string;
  deckName: string;
}

interface ReviewQueueProps {
  entries: QueueEntry[];
  activeId: string | null;
  onActivate(id: string): void;
  onOpen(id: string): void;
}

export function ReviewQueue({
  entries,
  activeId,
  onActivate,
  onOpen,
}: ReviewQueueProps): React.ReactElement {
  return (
    <section className="queue" aria-label="Review queue">
      {entries.length === 0 && (
        <div className="empty">
          Select something useful on a page, then click <strong>Collect selection</strong>.
        </div>
      )}
      {entries.map((entry) => (
        <button
          type="button"
          className="queue-row"
          key={entry.id}
          data-queue-id={entry.id}
          data-active={entry.id === activeId ? "true" : "false"}
          aria-label={`Open ${entry.canonicalText}, ${entry.status}, ${entry.occurrenceCount} occurrence${entry.occurrenceCount === 1 ? "" : "s"}`}
          onFocus={() => onActivate(entry.id)}
          onClick={() => onOpen(entry.id)}
        >
          <span className="queue-row-head">
            <span className="term" dir="auto">{entry.canonicalText}</span>
            <span className="pill">{entry.status}</span>
          </span>
          <span className="queue-meta">
            {entry.language} · {entry.occurrenceCount} occurrence{entry.occurrenceCount === 1 ? "" : "s"}
          </span>
          {entry.context && (
            <span className="queue-context" dir="auto">{entry.context}</span>
          )}
          <span className="queue-destination">
            Anki: {entry.deckName || "choose a deck in Settings"}
          </span>
        </button>
      ))}
    </section>
  );
}
