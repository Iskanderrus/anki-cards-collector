import type { BackupDocument } from "../backup/format";
import type {
  CaptureDraft,
  CollectedItem,
  ExportBinding,
  LexicalUnit,
  Occurrence,
  ReviewStatus,
} from "../core/types";
import { makeContentKey, normalizeIdentityText, normalizeText } from "../core/normalize";
import { CollectorDatabase, db as defaultDb } from "./database";

export interface EditLexicalUnitInput {
  canonicalText: string;
  language: string;
  note: string;
  occurrenceId?: string;
  surfaceText?: string;
  context?: string;
}

export interface CaptureBatchEntry {
  draft: CaptureDraft;
  targetLexicalUnitId?: string;
}

export interface RestorePreview {
  lexicalUnitsAdded: number;
  lexicalUnitsUpdated: number;
  lexicalUnitsSkipped: number;
  occurrencesAdded: number;
  occurrencesUpdated: number;
  occurrencesSkipped: number;
  exportBindingsAdded: number;
  exportBindingsSkipped: number;
  conflicts: string[];
}

interface RestorePlan {
  preview: RestorePreview;
  lexicalUnitsToAdd: LexicalUnit[];
  lexicalUnitsToUpdate: LexicalUnit[];
  occurrencesToAdd: Occurrence[];
  occurrencesToUpdate: Occurrence[];
  exportBindingsToAdd: ExportBinding[];
}

function occurrenceFingerprint(occurrence: Occurrence): string {
  return [
    occurrence.lexicalUnitId,
    occurrence.capturedAt,
    occurrence.normalizedSurfaceText,
    normalizeText(occurrence.context),
    occurrence.source.kind,
    occurrence.source.adapter,
    occurrence.source.url,
    occurrence.source.title,
  ].join("\u0000");
}

function sameOccurrence(left: Occurrence, right: Occurrence): boolean {
  return occurrenceFingerprint(left) === occurrenceFingerprint(right);
}

function combineNotes(primary: string, secondary: string): string {
  const first = primary.trim();
  const second = secondary.trim();
  if (!first) return second.slice(0, 2000);
  if (!second || first === second) return first.slice(0, 2000);
  return `${first}\n\n${second}`.slice(0, 2000);
}

function buildRestorePlan(
  backup: BackupDocument,
  localUnits: LexicalUnit[],
  localOccurrences: Occurrence[],
  localBindings: ExportBinding[],
): RestorePlan {
  const preview: RestorePreview = {
    lexicalUnitsAdded: 0,
    lexicalUnitsUpdated: 0,
    lexicalUnitsSkipped: 0,
    occurrencesAdded: 0,
    occurrencesUpdated: 0,
    occurrencesSkipped: 0,
    exportBindingsAdded: 0,
    exportBindingsSkipped: 0,
    conflicts: [],
  };
  const lexicalUnitsToAdd: LexicalUnit[] = [];
  const lexicalUnitsToUpdate: LexicalUnit[] = [];
  const occurrencesToAdd: Occurrence[] = [];
  const occurrencesToUpdate: Occurrence[] = [];
  const exportBindingsToAdd: ExportBinding[] = [];

  const unitsById = new Map(localUnits.map((unit) => [unit.id, unit]));
  const unitsByContentKey = new Map(localUnits.map((unit) => [unit.contentKey, unit]));
  const updatedUnitIds = new Set<string>();
  const conflictedUnitIds = new Set<string>();

  for (const item of backup.items) {
    const incoming = item.lexicalUnit;
    const current = unitsById.get(incoming.id);
    const contentOwner = unitsByContentKey.get(incoming.contentKey);

    if (contentOwner && contentOwner.id !== incoming.id) {
      preview.conflicts.push(
        `Canonical-form conflict: "${incoming.canonicalText}" (${incoming.language}) is already stored under another Collector ID.`,
      );
      conflictedUnitIds.add(incoming.id);
      continue;
    }

    if (!current) {
      lexicalUnitsToAdd.push(incoming);
      preview.lexicalUnitsAdded += 1;
      unitsById.set(incoming.id, incoming);
      unitsByContentKey.set(incoming.contentKey, incoming);
      updatedUnitIds.add(incoming.id);
      continue;
    }

    if (incoming.updatedAt > current.updatedAt) {
      lexicalUnitsToUpdate.push(incoming);
      preview.lexicalUnitsUpdated += 1;
      if (current.contentKey !== incoming.contentKey) {
        unitsByContentKey.delete(current.contentKey);
      }
      unitsById.set(incoming.id, incoming);
      unitsByContentKey.set(incoming.contentKey, incoming);
      updatedUnitIds.add(incoming.id);
    } else {
      preview.lexicalUnitsSkipped += 1;
    }
  }

  const occurrencesById = new Map(localOccurrences.map((occurrence) => [occurrence.id, occurrence]));
  const occurrenceFingerprints = new Set(localOccurrences.map(occurrenceFingerprint));

  for (const item of backup.items) {
    if (conflictedUnitIds.has(item.lexicalUnit.id)) continue;

    for (const incoming of item.occurrences) {
      const current = occurrencesById.get(incoming.id);

      if (current) {
        if (current.lexicalUnitId !== incoming.lexicalUnitId) {
          preview.conflicts.push(
            `Occurrence conflict: ${incoming.id} belongs to a different Collector ID locally.`,
          );
          continue;
        }

        if (updatedUnitIds.has(incoming.lexicalUnitId) && !sameOccurrence(current, incoming)) {
          occurrencesToUpdate.push(incoming);
          preview.occurrencesUpdated += 1;
          occurrenceFingerprints.delete(occurrenceFingerprint(current));
          occurrenceFingerprints.add(occurrenceFingerprint(incoming));
          occurrencesById.set(incoming.id, incoming);
        } else {
          preview.occurrencesSkipped += 1;
        }
        continue;
      }

      const fingerprint = occurrenceFingerprint(incoming);
      if (occurrenceFingerprints.has(fingerprint)) {
        preview.occurrencesSkipped += 1;
        continue;
      }

      occurrencesToAdd.push(incoming);
      preview.occurrencesAdded += 1;
      occurrenceFingerprints.add(fingerprint);
      occurrencesById.set(incoming.id, incoming);
    }
  }

  const bindingsByUnitId = new Map(
    localBindings.map((binding) => [binding.lexicalUnitId, binding]),
  );

  for (const incoming of backup.exportBindings) {
    if (conflictedUnitIds.has(incoming.lexicalUnitId)) continue;

    const current = bindingsByUnitId.get(incoming.lexicalUnitId);
    if (!current) {
      exportBindingsToAdd.push(incoming);
      preview.exportBindingsAdded += 1;
      bindingsByUnitId.set(incoming.lexicalUnitId, incoming);
      continue;
    }

    const same =
      current.profileId === incoming.profileId
      && current.ankiNoteId === incoming.ankiNoteId
      && current.deckName === incoming.deckName
      && current.modelName === incoming.modelName;

    if (same) {
      preview.exportBindingsSkipped += 1;
      continue;
    }

    preview.conflicts.push(
      `Export binding conflict: ${incoming.lexicalUnitId} already has a different local destination or Anki note.`,
    );
  }

  return {
    preview,
    lexicalUnitsToAdd,
    lexicalUnitsToUpdate,
    occurrencesToAdd,
    occurrencesToUpdate,
    exportBindingsToAdd,
  };
}

function compatibleBindings(
  left: ExportBinding | undefined,
  right: ExportBinding | undefined,
): boolean {
  if (!left || !right) return true;
  if (left.profileId !== right.profileId) return false;
  if (
    left.ankiNoteId !== undefined
    && right.ankiNoteId !== undefined
    && left.ankiNoteId !== right.ankiNoteId
  ) return false;
  if (left.deckName && right.deckName && left.deckName !== right.deckName) return false;
  if (left.modelName && right.modelName && left.modelName !== right.modelName) return false;
  return true;
}

function preferredBinding(
  primary: ExportBinding | undefined,
  secondary: ExportBinding | undefined,
  lexicalUnitId: string,
): ExportBinding | undefined {
  const source =
    primary?.ankiNoteId !== undefined ? primary
    : secondary?.ankiNoteId !== undefined ? secondary
    : primary ?? secondary;
  return source ? { ...source, lexicalUnitId } : undefined;
}

export class CaptureRepository {
  constructor(private readonly database: CollectorDatabase = defaultDb) {}

  private async findUniqueUnitByObservedSurface(
    normalizedSurfaceText: string,
    language: string,
  ): Promise<LexicalUnit | undefined> {
    const occurrences = await this.database.occurrences
      .where("normalizedSurfaceText")
      .equals(normalizedSurfaceText)
      .toArray();

    const ids = [...new Set(occurrences.map((occurrence) => occurrence.lexicalUnitId))];
    if (ids.length === 0) return undefined;

    const units = (await this.database.lexicalUnits.bulkGet(ids))
      .filter((unit): unit is LexicalUnit => unit !== undefined)
      .filter((unit) => unit.language === language);

    return units.length === 1 ? units[0] : undefined;
  }

  private async captureWithinTransaction(
    draft: CaptureDraft,
    targetLexicalUnitId?: string,
  ): Promise<LexicalUnit> {
    const surfaceText = normalizeText(draft.text);
    if (!surfaceText) throw new Error("Nothing selected.");

    const normalizedSurfaceText = normalizeIdentityText(surfaceText);
    const language = draft.language.trim().toLowerCase() || "und";
    const directContentKey = makeContentKey(surfaceText, language);
    const now = draft.capturedAt || new Date().toISOString();
    let lexicalUnit: LexicalUnit;

    if (targetLexicalUnitId) {
      const target = await this.database.lexicalUnits.get(targetLexicalUnitId);
      if (!target) throw new Error("Target lexical unit no longer exists.");
      if (target.language !== language) {
        throw new Error("Target lexical unit uses a different language.");
      }

      lexicalUnit = { ...target, updatedAt: now };
      await this.database.lexicalUnits.put(lexicalUnit);
    } else {
      const direct = await this.database.lexicalUnits
        .where("contentKey")
        .equals(directContentKey)
        .first();
      const observedOwner = direct
        ? undefined
        : await this.findUniqueUnitByObservedSurface(normalizedSurfaceText, language);
      const existing = direct ?? observedOwner;

      if (existing) {
        lexicalUnit = { ...existing, updatedAt: now };
        await this.database.lexicalUnits.put(lexicalUnit);
      } else {
        lexicalUnit = {
          id: crypto.randomUUID(),
          contentKey: directContentKey,
          canonicalText: surfaceText,
          normalizedCanonicalText: normalizedSurfaceText,
          language,
          note: "",
          status: "inbox",
          createdAt: now,
          updatedAt: now,
        };
        await this.database.lexicalUnits.add(lexicalUnit);
      }
    }

    await this.database.occurrences.add({
      id: crypto.randomUUID(),
      lexicalUnitId: lexicalUnit.id,
      surfaceText,
      normalizedSurfaceText,
      context: normalizeText(draft.context).slice(0, 800),
      source: draft.source,
      capturedAt: now,
    });

    return lexicalUnit;
  }

  private async collectedItem(id: string): Promise<CollectedItem> {
    const lexicalUnit = await this.database.lexicalUnits.get(id);
    if (!lexicalUnit) throw new Error("Collected item no longer exists.");

    const occurrences = await this.database.occurrences
      .where("lexicalUnitId")
      .equals(id)
      .sortBy("capturedAt");

    return { lexicalUnit, occurrences };
  }

  async capture(draft: CaptureDraft): Promise<CollectedItem> {
    let lexicalUnit!: LexicalUnit;

    await this.database.transaction(
      "rw",
      this.database.lexicalUnits,
      this.database.occurrences,
      async () => {
        lexicalUnit = await this.captureWithinTransaction(draft);
      },
    );

    return this.collectedItem(lexicalUnit.id);
  }

  async captureBatch(entries: readonly CaptureBatchEntry[]): Promise<CollectedItem[]> {
    if (entries.length === 0) return [];

    const lexicalUnitIds: string[] = [];

    await this.database.transaction(
      "rw",
      this.database.lexicalUnits,
      this.database.occurrences,
      async () => {
        for (const entry of entries) {
          const lexicalUnit = await this.captureWithinTransaction(
            entry.draft,
            entry.targetLexicalUnitId,
          );
          lexicalUnitIds.push(lexicalUnit.id);
        }
      },
    );

    return Promise.all(lexicalUnitIds.map((id) => this.collectedItem(id)));
  }

  async list(status?: ReviewStatus): Promise<CollectedItem[]> {
    const units = status
      ? await this.database.lexicalUnits.where("status").equals(status).toArray()
      : await this.database.lexicalUnits.toArray();
    const occurrences = await this.database.occurrences.toArray();
    const grouped = new Map<string, Occurrence[]>();

    for (const occurrence of occurrences) {
      const values = grouped.get(occurrence.lexicalUnitId) ?? [];
      values.push(occurrence);
      grouped.set(occurrence.lexicalUnitId, values);
    }

    return units
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((lexicalUnit) => ({
        lexicalUnit,
        occurrences: (grouped.get(lexicalUnit.id) ?? [])
          .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)),
      }));
  }

  async update(id: string, changes: EditLexicalUnitInput): Promise<CollectedItem> {
    const canonicalText = normalizeText(changes.canonicalText);
    if (!canonicalText) throw new Error("Canonical form cannot be empty.");

    const language = changes.language.trim().toLowerCase() || "und";
    const normalizedCanonicalText = normalizeIdentityText(canonicalText);
    const contentKey = makeContentKey(canonicalText, language);
    const requestedNote = changes.note.trim().slice(0, 2000);
    const requestedSurface = changes.surfaceText === undefined
      ? undefined
      : normalizeText(changes.surfaceText);
    if (changes.surfaceText !== undefined && !requestedSurface) {
      throw new Error("Observed form cannot be empty.");
    }

    const now = new Date().toISOString();
    let lexicalUnit!: LexicalUnit;
    let resultId = id;

    await this.database.transaction(
      "rw",
      this.database.lexicalUnits,
      this.database.occurrences,
      this.database.exportBindings,
      async () => {
        const current = await this.database.lexicalUnits.get(id);
        if (!current) throw new Error("Collected item no longer exists.");

        const collision = await this.database.lexicalUnits
          .where("contentKey")
          .equals(contentKey)
          .first();

        if (collision && collision.id !== id) {
          const [currentBinding, collisionBinding] = await Promise.all([
            this.database.exportBindings.get(current.id),
            this.database.exportBindings.get(collision.id),
          ]);

          if (!compatibleBindings(currentBinding, collisionBinding)) {
            throw new Error(
              "Cannot consolidate these forms because they use different export destinations or Anki notes.",
            );
          }

          const currentHasIdentity =
            currentBinding?.ankiNoteId !== undefined || current.ankiNoteId !== undefined;
          const collisionHasIdentity =
            collisionBinding?.ankiNoteId !== undefined || collision.ankiNoteId !== undefined;
          if (
            current.ankiNoteId !== undefined &&
            collision.ankiNoteId !== undefined &&
            current.ankiNoteId !== collision.ankiNoteId
          ) {
            throw new Error(
              "Cannot consolidate these forms because both are linked to different Anki notes.",
            );
          }

          const keepCurrent = currentHasIdentity && !collisionHasIdentity;
          const mergedNote = combineNotes(requestedNote, collision.note);
          const createdAt = current.createdAt < collision.createdAt
            ? current.createdAt
            : collision.createdAt;

          if (keepCurrent) {
            await this.database.occurrences
              .where("lexicalUnitId")
              .equals(collision.id)
              .modify({ lexicalUnitId: current.id });
            await this.database.lexicalUnits.delete(collision.id);
            const binding = preferredBinding(currentBinding, collisionBinding, current.id);
            await this.database.exportBindings.delete(collision.id);
            if (binding) await this.database.exportBindings.put(binding);

            lexicalUnit = {
              ...current,
              contentKey,
              canonicalText,
              normalizedCanonicalText,
              language,
              note: mergedNote,
              status: "inbox",
              createdAt,
              updatedAt: now,
            };
            await this.database.lexicalUnits.put(lexicalUnit);
            resultId = current.id;
          } else {
            await this.database.occurrences
              .where("lexicalUnitId")
              .equals(current.id)
              .modify({ lexicalUnitId: collision.id });
            await this.database.lexicalUnits.delete(current.id);
            const binding = preferredBinding(collisionBinding, currentBinding, collision.id);
            await this.database.exportBindings.delete(current.id);
            if (binding) await this.database.exportBindings.put(binding);

            lexicalUnit = {
              ...collision,
              contentKey,
              canonicalText,
              normalizedCanonicalText,
              language,
              note: mergedNote,
              status: "inbox",
              createdAt,
              updatedAt: now,
            };
            await this.database.lexicalUnits.put(lexicalUnit);
            resultId = collision.id;
          }
        } else {
          lexicalUnit = {
            ...current,
            contentKey,
            canonicalText,
            normalizedCanonicalText,
            language,
            note: requestedNote,
            status: current.status === "ready" ? "inbox" : current.status,
            updatedAt: now,
          };
          await this.database.lexicalUnits.put(lexicalUnit);
        }

        if (
          changes.occurrenceId !== undefined &&
          (changes.context !== undefined || requestedSurface !== undefined)
        ) {
          const occurrence = await this.database.occurrences.get(changes.occurrenceId);
          if (!occurrence || occurrence.lexicalUnitId !== resultId) {
            throw new Error("The selected occurrence no longer belongs to this item.");
          }

          await this.database.occurrences.update(occurrence.id, {
            ...(changes.context === undefined
              ? {}
              : { context: normalizeText(changes.context).slice(0, 800) }),
            ...(requestedSurface === undefined
              ? {}
              : {
                  surfaceText: requestedSurface,
                  normalizedSurfaceText: normalizeIdentityText(requestedSurface),
                }),
          });
        }
      },
    );

    const occurrences = await this.database.occurrences
      .where("lexicalUnitId")
      .equals(resultId)
      .sortBy("capturedAt");

    return { lexicalUnit, occurrences };
  }

  async previewRestore(backup: BackupDocument): Promise<RestorePreview> {
    const [localUnits, localOccurrences, localBindings] = await Promise.all([
      this.database.lexicalUnits.toArray(),
      this.database.occurrences.toArray(),
      this.database.exportBindings.toArray(),
    ]);
    return buildRestorePlan(backup, localUnits, localOccurrences, localBindings).preview;
  }

  async restoreBackup(backup: BackupDocument): Promise<RestorePreview> {
    let completedPreview!: RestorePreview;

    await this.database.transaction(
      "rw",
      this.database.lexicalUnits,
      this.database.occurrences,
      this.database.exportBindings,
      async () => {
        const [localUnits, localOccurrences, localBindings] = await Promise.all([
          this.database.lexicalUnits.toArray(),
          this.database.occurrences.toArray(),
          this.database.exportBindings.toArray(),
        ]);
        const plan = buildRestorePlan(backup, localUnits, localOccurrences, localBindings);

        if (plan.preview.conflicts.length > 0) {
          throw new Error(`Backup has ${plan.preview.conflicts.length} conflict(s). Resolve them before restoring.`);
        }

        for (const unit of plan.lexicalUnitsToAdd) {
          await this.database.lexicalUnits.add(unit);
        }
        for (const unit of plan.lexicalUnitsToUpdate) {
          await this.database.lexicalUnits.put(unit);
        }
        for (const occurrence of plan.occurrencesToAdd) {
          await this.database.occurrences.add(occurrence);
        }
        for (const occurrence of plan.occurrencesToUpdate) {
          await this.database.occurrences.put(occurrence);
        }
        for (const binding of plan.exportBindingsToAdd) {
          await this.database.exportBindings.add(binding);
        }

        completedPreview = plan.preview;
      },
    );

    return completedPreview;
  }

  async listExportBindings(): Promise<ExportBinding[]> {
    return this.database.exportBindings.toArray();
  }

  async getExportBinding(lexicalUnitId: string): Promise<ExportBinding | null> {
    return await this.database.exportBindings.get(lexicalUnitId) ?? null;
  }

  async setExportBinding(binding: Omit<ExportBinding, "updatedAt"> & { updatedAt?: string }): Promise<void> {
    const lexicalUnit = await this.database.lexicalUnits.get(binding.lexicalUnitId);
    if (!lexicalUnit) throw new Error("Collected item no longer exists.");

    await this.database.exportBindings.put({
      ...binding,
      updatedAt: binding.updatedAt ?? new Date().toISOString(),
    });
  }

  async clearExportBinding(lexicalUnitId: string): Promise<void> {
    await this.database.exportBindings.delete(lexicalUnitId);
  }

  async setStatus(id: string, status: ReviewStatus): Promise<void> {
    await this.database.lexicalUnits.update(id, {
      status,
      updatedAt: new Date().toISOString(),
    });
  }

  async setAnkiNoteId(id: string, ankiNoteId: number): Promise<void> {
    await this.database.lexicalUnits.update(id, {
      ankiNoteId,
      updatedAt: new Date().toISOString(),
    });
  }

  async remove(id: string): Promise<void> {
    await this.database.transaction(
      "rw",
      this.database.lexicalUnits,
      this.database.occurrences,
      this.database.exportBindings,
      async () => {
        await this.database.occurrences.where("lexicalUnitId").equals(id).delete();
        await this.database.exportBindings.delete(id);
        await this.database.lexicalUnits.delete(id);
      },
    );
  }
}

export const repository = new CaptureRepository();
