import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { BackupDocumentV1 } from "../backup/format";
import { parseBackup, serializeBackup } from "../backup/format";
import type { CollectedItem, CollectorSettings, ReviewStatus } from "../core/types";
import type { RestorePreview } from "../storage/repository";
import { repository } from "../storage/repository";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../settings";
import { AnkiClient } from "../anki/client";
import { downloadText, toTsv } from "../anki/export";

interface EditDraft {
  displayText: string;
  language: string;
  context: string;
  note: string;
  occurrenceId?: string;
}

function latestContext(item: CollectedItem): string {
  return item.occurrences.at(-1)?.context ?? "";
}

function sourceLabel(item: CollectedItem): string {
  const source = item.occurrences.at(-1)?.source;
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
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [pendingBackup, setPendingBackup] = useState<BackupDocumentV1 | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);

  const load = useCallback(async () => {
    setItems(await repository.list());
    setSettings(await loadSettings());
  }, []);

  useEffect(() => {
    void load();
    const listener = (message: unknown) => {
      const event = message as { type?: string; error?: string };
      if (event.type === "DATA_CHANGED") void load();
      if (event.type === "CAPTURE_ERROR") setError(event.error ?? "Capture failed.");
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [load]);

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

  async function changeStatus(id: string, status: ReviewStatus): Promise<void> {
    await repository.setStatus(id, status);
    await load();
  }

  function beginEdit(item: CollectedItem): void {
    const occurrence = item.occurrences.at(-1);
    setEditingId(item.lexicalUnit.id);
    setEditDraft({
      displayText: item.lexicalUnit.displayText,
      language: item.lexicalUnit.language,
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
      await repository.update(id, editDraft);
      cancelEdit();
      setNotice("Changes saved. The next Anki export will update the same Collector note.");
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

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const client = new AnkiClient();
      await client.ping();
      await client.ensureDeckAndModel(settings);

      let exported = 0;
      for (const item of ready) {
        const noteId = await client.upsert(item, settings);
        await repository.setAnkiNoteId(item.lexicalUnit.id, noteId);
        exported += 1;
      }

      setNotice(`Sent ${exported} item${exported === 1 ? "" : "s"} to Anki.`);
      await load();
    } catch (ankiError) {
      setError(
        ankiError instanceof Error
          ? `${ankiError.message} Is Anki running with AnkiConnect enabled?`
          : "Anki export failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function persistSettings(next: CollectorSettings): Promise<void> {
    setSettings(next);
    await saveSettings(next);
  }

  function exportTsv(): void {
    const ready = items.filter((item) => item.lexicalUnit.status === "ready");
    downloadText("anki-cards-collector.tsv", toTsv(ready), "text/tab-separated-values;charset=utf-8");
  }

  function backupJson(): void {
    downloadText(
      "anki-cards-collector-backup.json",
      serializeBackup(items),
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
      setPendingBackup(backup);
      setRestorePreview(preview);

      if (preview.conflicts.length > 0) {
        setError(
          `Backup has ${preview.conflicts.length} conflict${preview.conflicts.length === 1 ? "" : "s"} and cannot be restored yet.`,
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

    try {
      const result = await repository.restoreBackup(pendingBackup);
      clearRestorePreview();
      await load();

      const changed =
        result.lexicalUnitsAdded +
        result.lexicalUnitsUpdated +
        result.occurrencesAdded +
        result.occurrencesUpdated;
      setNotice(
        changed === 0
          ? "Backup is already fully represented in the local corpus."
          : `Backup restored: ${result.lexicalUnitsAdded} items added, ${result.lexicalUnitsUpdated} updated, ${result.occurrencesAdded} occurrences added.`,
      );
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Backup restore failed.");
    } finally {
      setBusy(false);
    }
  }

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

      <div className="summary">
        <span>{counts.inbox} to review</span>
        <span>{counts.ready} ready</span>
        <span>{items.length} unique total</span>
      </div>

      {notice && <div className="notice">{notice}</div>}
      {error && <div className="notice error">{error}</div>}

      <details className="settings">
        <summary>Settings & fallback exports</summary>
        <div className="settings-grid">
          <label>
            Language code
            <input
              value={settings.defaultLanguage}
              placeholder="es, sr, he…"
              onChange={(event) => void persistSettings({ ...settings, defaultLanguage: event.target.value || "und" })}
            />
          </label>
          <label>
            Anki deck
            <input
              value={settings.deckName}
              onChange={(event) => void persistSettings({ ...settings, deckName: event.target.value })}
            />
          </label>
          <label>
            Anki note type
            <input
              value={settings.modelName}
              onChange={(event) => void persistSettings({ ...settings, modelName: event.target.value })}
            />
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

          return (
            <article className="card" key={unit.id}>
              <div className="card-head">
                <div>
                  <div className="term">{unit.displayText}</div>
                  <div className="meta">
                    {unit.language} · {sourceLabel(item)} · {item.occurrences.length} occurrence{item.occurrences.length === 1 ? "" : "s"}
                  </div>
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
                    Expression
                    <input
                      autoFocus
                      value={editDraft.displayText}
                      onChange={(event) => setEditDraft({ ...editDraft, displayText: event.target.value })}
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
                  {latestContext(item) && <p className="context">{latestContext(item)}</p>}
                  {unit.note && <p className="learner-note">{unit.note}</p>}

                  <div className="card-actions">
                    <button disabled={busy} onClick={() => beginEdit(item)}>Edit</button>
                    {unit.status !== "ready" && (
                      <button disabled={busy} onClick={() => void changeStatus(unit.id, "ready")}>Ready</button>
                    )}
                    {unit.status !== "inbox" && (
                      <button disabled={busy} onClick={() => void changeStatus(unit.id, "inbox")}>Back to inbox</button>
                    )}
                    {unit.status !== "archived" && (
                      <button className="ghost" disabled={busy} onClick={() => void changeStatus(unit.id, "archived")}>Archive</button>
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
