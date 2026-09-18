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
      canonicalText: string;
      noteId: number;
    }
  | {
      kind: "exported_untracked";
      id: string;
      canonicalText: string;
      noteId: number;
      error: string;
    }
  | {
      kind: "failed";
      id: string;
      canonicalText: string;
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
    const canonicalText = item.lexicalUnit.canonicalText;
    onProgress({
      completed: results.length,
      total,
      currentId: id,
      currentText: canonicalText,
    });

    try {
      const noteId = await client.upsert(item, settings);
      exported += 1;

      try {
        await persistNoteId(id, noteId);
        results.push({ kind: "exported", id, canonicalText, noteId });
      } catch (persistError) {
        warnings += 1;
        results.push({
          kind: "exported_untracked",
          id,
          canonicalText,
          noteId,
          error: `Anki export succeeded, but the local note ID was not saved: ${errorMessage(persistError)}`,
        });
      }
    } catch (exportError) {
      failed += 1;
      results.push({
        kind: "failed",
        id,
        canonicalText,
        error: errorMessage(exportError),
      });
    }

    onProgress({
      completed: results.length,
      total,
      currentId: id,
      currentText: canonicalText,
    });
  }

  return { total, exported, failed, warnings, results };
}
