import type {
  CollectedItem,
  CollectorSettings,
  ExportBinding,
  ExportProfile,
} from "../core/types";
import { resolveExportRoute, validateProfileForCurrentExport } from "./routing";

export interface AnkiExportClient {
  ping(): Promise<number>;
  ensureDeckAndModel(profile: ExportProfile): Promise<void>;
  preflight(item: CollectedItem, profile: ExportProfile): Promise<void>;
  upsert(item: CollectedItem, profile: ExportProfile, existingNoteId?: number): Promise<number>;
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
      profileId: string;
      deckName: string;
    }
  | {
      kind: "exported_untracked";
      id: string;
      canonicalText: string;
      noteId: number;
      profileId: string;
      deckName: string;
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

export type PersistExportBinding = (binding: ExportBinding) => Promise<void>;

interface RoutedItem {
  item: CollectedItem;
  binding: ExportBinding | null;
  profile: ExportProfile;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown export error.";
}

function failedOutcome(item: CollectedItem, error: unknown): ExportItemOutcome {
  return {
    kind: "failed",
    id: item.lexicalUnit.id,
    canonicalText: item.lexicalUnit.canonicalText,
    error: errorMessage(error),
  };
}

function resolvedDestinationKey(profile: ExportProfile): string {
  return JSON.stringify([
    profile.id,
    profile.deckName,
    profile.deckId ?? "",
    profile.modelName,
    profile.modelId ?? "",
    profile.mode,
  ]);
}

export async function exportBatch(
  items: CollectedItem[],
  settings: CollectorSettings,
  bindings: ReadonlyMap<string, ExportBinding>,
  client: AnkiExportClient,
  persistBinding: PersistExportBinding,
  onProgress: (progress: ExportProgress) => void = () => undefined,
): Promise<ExportBatchReport> {
  const total = items.length;
  onProgress({ completed: 0, total });

  await client.ping();

  const results: ExportItemOutcome[] = [];
  const routed: RoutedItem[] = [];

  for (const item of items) {
    try {
      const binding = bindings.get(item.lexicalUnit.id) ?? null;
      const route = resolveExportRoute(item, settings, binding);
      validateProfileForCurrentExport(route.profile);
      routed.push({ item, binding, profile: route.profile });
    } catch (error) {
      results.push(failedOutcome(item, error));
    }
  }

  const groups = new Map<string, RoutedItem[]>();
  for (const entry of routed) {
    const key = resolvedDestinationKey(entry.profile);
    const values = groups.get(key) ?? [];
    values.push(entry);
    groups.set(key, values);
  }

  for (const entries of groups.values()) {
    const profile = entries[0]!.profile;

    try {
      await client.ensureDeckAndModel(profile);
    } catch (error) {
      for (const entry of entries) results.push(failedOutcome(entry.item, error));
      continue;
    }

    for (const { item, binding } of entries) {
      const id = item.lexicalUnit.id;
      const canonicalText = item.lexicalUnit.canonicalText;
      onProgress({
        completed: results.length,
        total,
        currentId: id,
        currentText: canonicalText,
      });

      try {
        await client.preflight(item, profile);

        let effectiveBinding = binding;
        const needsReservation =
          binding?.ankiNoteId === undefined
          && binding?.state !== "reserved"
          && binding?.state !== "exported";

        if (needsReservation) {
          const reserved: ExportBinding = {
            lexicalUnitId: id,
            profileId: profile.id,
            state: "reserved",
            deckName: profile.deckName,
            ...(profile.deckId ? { deckId: profile.deckId } : {}),
            modelName: profile.modelName,
            ...(profile.modelId ? { modelId: profile.modelId } : {}),
            updatedAt: new Date().toISOString(),
          };
          await persistBinding(reserved);
          effectiveBinding = reserved;
        }

        const noteId = await client.upsert(
          item,
          profile,
          effectiveBinding?.ankiNoteId ?? item.lexicalUnit.ankiNoteId,
        );

        const persisted: ExportBinding = {
          lexicalUnitId: id,
          profileId: profile.id,
          state: "exported",
          ankiNoteId: noteId,
          deckName: profile.deckName,
          ...(profile.deckId ? { deckId: profile.deckId } : {}),
          modelName: profile.modelName,
          ...(profile.modelId ? { modelId: profile.modelId } : {}),
          updatedAt: new Date().toISOString(),
        };

        try {
          await persistBinding(persisted);
          results.push({
            kind: "exported",
            id,
            canonicalText,
            noteId,
            profileId: profile.id,
            deckName: profile.deckName,
          });
        } catch (persistError) {
          results.push({
            kind: "exported_untracked",
            id,
            canonicalText,
            noteId,
            profileId: profile.id,
            deckName: profile.deckName,
            error: `Anki export succeeded and the destination remains pinned, but the local Anki note ID was not saved: ${errorMessage(persistError)}`,
          });
        }
      } catch (exportError) {
        results.push(failedOutcome(item, exportError));
      }

      onProgress({
        completed: results.length,
        total,
        currentId: id,
        currentText: canonicalText,
      });
    }
  }

  // Route/setup failures are discovered before grouped item processing, so final
  // result order follows the input for predictable UI reporting.
  const byId = new Map(results.map((result) => [result.id, result]));
  const ordered = items.map((item) => byId.get(item.lexicalUnit.id)!).filter(Boolean);
  const exported = ordered.filter((result) => result.kind !== "failed").length;
  const failed = ordered.filter((result) => result.kind === "failed").length;
  const warnings = ordered.filter((result) => result.kind === "exported_untracked").length;

  onProgress({ completed: total, total });
  return { total, exported, failed, warnings, results: ordered };
}
