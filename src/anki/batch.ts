import type { CollectedItem, CollectorSettings } from "../core/types";

export interface AnkiExportClient {
  ping(): Promise<number>;
  ensureDeckAndModel(settings: CollectorSettings): Promise<void>;
  upsert(item: CollectedItem, settings: CollectorSettings): Promise<number>;
}

export interface ExportProgress {
  completed: number;
  total: number;
  currentId?: string;
  currentText?: string;
}

export type ExportItemOutcome =
  | {
      kind: "exported";
      id: string;
      displayText: string;
      noteId: number;
    }
  | {
      kind: "exported_untracked";
      id: string;
      displayText: string;
      noteId: number;
      error: string;
    }
  | {
      kind: "failed";
      id: string;
      displayText: string;
      error: string;
    };

export interface ExportBatchReport {
  total: number;
  exported: number;
  failed: number;
  warnings: number;
  results: ExportItemOutcome[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown export error.";
}

export async function exportBatch(
  items: CollectedItem[],
  settings: CollectorSettings,
  client: AnkiExportClient,
  persistNoteId: (id: string, noteId: number) => Promise<void>,
  onProgress: (progress: ExportProgress) => void = () => undefined,
): Promise<ExportBatchReport> {
  const total = items.length;
  onProgress({ completed: 0, total });

  await client.ping();
  await client.ensureDeckAndModel(settings);

  const results: ExportItemOutcome[] = [];
  let exported = 0;
  let failed = 0;
  let warnings = 0;

  for (const item of items) {
    const id = item.lexicalUnit.id;
    const displayText = item.lexicalUnit.displayText;
    onProgress({
      completed: results.length,
      total,
      currentId: id,
      currentText: displayText,
    });

    try {
      const noteId = await client.upsert(item, settings);
      exported += 1;

      try {
        await persistNoteId(id, noteId);
        results.push({ kind: "exported", id, displayText, noteId });
      } catch (persistError) {
        warnings += 1;
        results.push({
          kind: "exported_untracked",
          id,
          displayText,
          noteId,
          error: `Anki export succeeded, but the local note ID was not saved: ${errorMessage(persistError)}`,
        });
      }
    } catch (exportError) {
      failed += 1;
      results.push({
        kind: "failed",
        id,
        displayText,
        error: errorMessage(exportError),
      });
    }

    onProgress({
      completed: results.length,
      total,
      currentId: id,
      currentText: displayText,
    });
  }

  return { total, exported, failed, warnings, results };
}
