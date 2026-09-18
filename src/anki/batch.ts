import type { CollectedItem, CollectorSettings } from "../core/types";

export interface BatchAnkiClient {
  upsert(item: CollectedItem, settings: CollectorSettings): Promise<number>;
}

export interface ExportProgress {
  completed: number;
  total: number;
  currentDisplayText: string;
}

export interface ExportFailure {
  id: string;
  displayText: string;
  message: string;
}

export interface BatchExportResult {
  succeeded: number;
  failures: ExportFailure[];
}

type PersistNoteId = (id: string, noteId: number) => Promise<void>;
type ProgressListener = (progress: ExportProgress) => void;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown export error.";
}

export async function exportReadyItems(
  items: CollectedItem[],
  client: BatchAnkiClient,
  settings: CollectorSettings,
  persistNoteId: PersistNoteId,
  onProgress: ProgressListener = () => undefined,
): Promise<BatchExportResult> {
  const failures: ExportFailure[] = [];
  let succeeded = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    onProgress({
      completed: index,
      total: items.length,
      currentDisplayText: item.lexicalUnit.displayText,
    });

    try {
      const noteId = await client.upsert(item, settings);
      await persistNoteId(item.lexicalUnit.id, noteId);
      succeeded += 1;
    } catch (error) {
      failures.push({
        id: item.lexicalUnit.id,
        displayText: item.lexicalUnit.displayText,
        message: errorMessage(error),
      });
    }
  }

  return { succeeded, failures };
}
