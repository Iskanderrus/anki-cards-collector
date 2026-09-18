import type { BackupDocument } from "../backup/format";
import type { CaptureDraft, CollectedItem, LexicalUnit, Occurrence, ReviewStatus } from "../core/types";
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

export interface RestorePreview {
  lexicalUnitsAdded: number;
  lexicalUnitsUpdated: number;
  lexicalUnitsSkipped: number;
  occurrencesAdded: number;
  occurrencesUpdated: number;
  occurrencesSkipped: number;
  conflicts: string[];
}

interface RestorePlan {
  preview: RestorePreview;
  lexicalUnitsToAdd: LexicalUnit[];
  lexicalUnitsToUpdate: LexicalUnit[];
  occurrencesToAdd: Occurrence[];
  occurrencesToUpdate: Occurrence[];
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
): RestorePlan {
  const preview: RestorePreview = {
    lexicalUnitsAdded: 0,
    lexicalUnitsUpdated: 0,
    lexicalUnitsSkipped: 0,
    occurrencesAdded: 0,
    occurrencesUpdated: 0,
    occurrencesSkipped: 0,
    conflicts: [],
  };
  const lexicalUnitsToAdd: LexicalUnit[] = [];
  const lexicalUnitsToUpdate: LexicalUnit[] = [];
  const occurrencesToAdd: Occurrence[] = [];
  const occurrencesToUpdate: Occurrence[] = [];

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

  return {
    preview,
    lexicalUnitsToAdd,
    lexicalUnitsToUpdate,
    occurrencesToAdd,
    occurrencesToUpdate,
  };
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

  async capture(draft: CaptureDraft): Promise<CollectedItem> {
    const surfaceText = normalizeText(draft.text);
    if (!surfaceText) throw new Error("Nothing selected.");

    const normalizedSurfaceText = normalizeIdentityText(surfaceText);
    const language = draft.language.trim().toLowerCase() || "und";
    const directContentKey = makeContentKey(surfaceText, language);
    const now = draft.capturedAt || new Date().toISOString();
    let lexicalUnit!: LexicalUnit;

    await this.database.transaction(
      "rw",
      this.database.lexicalUnits,
      this.database.occurrences,
      async () => {
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

        await this.database.occurrences.add({
          id: crypto.randomUUID(),
          lexicalUnitId: lexicalUnit.id,
          surfaceText,
          normalizedSurfaceText,
          context: normalizeText(draft.context).slice(0, 800),
          source: draft.source,
          capturedAt: now,
        });
      },
    );

    const occurrences = await this.database.occurrences
      .where("lexicalUnitId")
      .equals(lexicalUnit.id)
      .sortBy("capturedAt");

    return { lexicalUnit, occurrences };
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
      async () => {
        const current = await this.database.lexicalUnits.get(id);
        if (!current) throw new Error("Collected item no longer exists.");

        const collision = await this.database.lexicalUnits
          .where("contentKey")
          .equals(contentKey)
          .first();

        if (collision && collision.id !== id) {
          if (
            current.ankiNoteId !== undefined &&
            collision.ankiNoteId !== undefined &&
            current.ankiNoteId !== collision.ankiNoteId
          ) {
            throw new Error(
              "Cannot consolidate these forms because both are linked to different Anki notes.",
            );
          }

          const keepCurrent =
            current.ankiNoteId !== undefined && collision.ankiNoteId === undefined;
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
    const [localUnits, localOccurrences] = await Promise.all([
      this.database.lexicalUnits.toArray(),
      this.database.occurrences.toArray(),
    ]);
    return buildRestorePlan(backup, localUnits, localOccurrences).preview;
  }

  async restoreBackup(backup: BackupDocument): Promise<RestorePreview> {
    let completedPreview!: RestorePreview;

    await this.database.transaction(
      "rw",
      this.database.lexicalUnits,
      this.database.occurrences,
      async () => {
        const [localUnits, localOccurrences] = await Promise.all([
          this.database.lexicalUnits.toArray(),
          this.database.occurrences.toArray(),
        ]);
        const plan = buildRestorePlan(backup, localUnits, localOccurrences);

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

        completedPreview = plan.preview;
      },
    );

    return completedPreview;
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
      async () => {
        await this.database.occurrences.where("lexicalUnitId").equals(id).delete();
        await this.database.lexicalUnits.delete(id);
      },
    );
  }
}

export const repository = new CaptureRepository();
