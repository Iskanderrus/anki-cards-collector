import React, { useEffect, useRef } from "react";
import type { ExportPreview } from "./export-preview";

interface ExportPreviewDialogProps {
  preview: ExportPreview;
  busy: boolean;
  onClose(): void;
  onExport(): void;
}

export function ExportPreviewDialog({
  preview,
  busy,
  onClose,
  onExport,
}: ExportPreviewDialogProps): React.ReactElement {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="product-dialog export-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-preview-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <h2 id="export-preview-title" ref={headingRef} tabIndex={-1}>Export Ready items</h2>
        {preview.totalReady === 0 ? (
          <div className="empty">
            Nothing is Ready for export yet. Review Inbox items and mark the ones you want to study as Ready.
          </div>
        ) : (
          <>
            <div className="export-preview-counts" role="status" aria-live="polite">
              <strong>{preview.totalReady} Ready</strong>
              <span>{preview.exportable} exportable now</span>
              <span>{preview.blocked} blocked</span>
            </div>

            {preview.groups.length > 0 && (
              <div className="export-preview-groups" aria-label="Resolved Anki destinations">
                {preview.groups.map((group) => (
                  <div className="export-preview-group" key={group.key}>
                    <div>
                      <strong>{group.profileName}</strong>
                      <span>{group.count} item{group.count === 1 ? "" : "s"}</span>
                    </div>
                    <div className="export-preview-route">
                      <span>→ {group.deckName}</span>
                      <span className="setting-help">Note type: {group.modelName}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {preview.blockedItems.length > 0 && (
              <details className="export-preview-blocked" open>
                <summary>{preview.blockedItems.length} blocked item{preview.blockedItems.length === 1 ? "" : "s"}</summary>
                <ul>
                  {preview.blockedItems.map((item) => (
                    <li key={item.id}>
                      <strong dir="auto">{item.canonicalText}</strong>
                      <span>{item.reason}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <p className="setting-help">
              Ready means you explicitly approved these study items. Collector uses the saved language/profile routes and any deliberate per-item destination overrides shown above.
            </p>
          </>
        )}

        <div className="dialog-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="primary"
            disabled={busy || preview.exportable === 0}
            onClick={onExport}
          >
            Export {preview.exportable || ""} {preview.exportable === 1 ? "item" : "items"}
          </button>
        </div>
      </section>
    </div>
  );
}
