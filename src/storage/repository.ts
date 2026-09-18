import type { CaptureDraft, CollectedItem, LexicalUnit, Occurrence, ReviewStatus } from "../core/types";
import { makeContentKey, normalizeText } from "../core/normalize";
import { CollectorDatabase, db as defaultDb } from "./database";

export interface EditLexicalUnitInput {
  displayText: string;
  language: string;
  note: string;
  occurrenceId?: string;
  context?: string;
}

export class CaptureRepository {
  constructor(private readonly database: CollectorDatabase = defaultDb) {}

  async capture(draft: CaptureDraft): Promise<CollectedItem> {
    const normalizedText = normalizeText(draft.text);
    if (!normalizedText) throw new Error("Nothing selected.");

    const language = draft.language.trim().toLowerCase() || "und";
    const contentKey = makeContentKey(normalizedText, language);
    const now = draft.capturedAt || new Date().toISOString();
    let lexicalUnit!: LexicalUnit;

    await this.database.transaction(
      "rw",
      this.database.lexicalUnits,
      this.database.occurrences,
      async () => {
        const existing = await this.database.lexicalUnits.where("contentKey").equals(contentKey).first();

        if (existing) {
          lexicalUnit = { ...existing, updatedAt: now };
          await this.database.lexicalUnits.put(lexicalUnit);
        } else {
          lexicalUnit = {
            id: crypto.randomUUID(),
            contentKey,
            displayText: normalizedText,
            normalizedText,
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
    const displayText = normalizeText(changes.displayText);
    if (!displayText) throw new Error("Expression cannot be empty.");

    const language = changes.language.trim().toLowerCase() || "und";
    const contentKey = makeContentKey(displayText, language);
    const note = changes.note.trim().slice(0, 2000);
    const now = new Date().toISOString();
    let lexicalUnit!: LexicalUnit;

    await this.database.transaction(
      "rw",
      this.database.lexicalUnits,
      this.database.occurrences,
      async () => {
        const current = await this.database.lexicalUnits.get(id);
        if (!current) throw new Error("Collected item no longer exists.");

        const collision = await this.database.lexicalUnits.where("contentKey").equals(contentKey).first();
        if (collision && collision.id !== id) {
          throw new Error("Another collected item already uses this expression and language.");
        }

        lexicalUnit = {
          ...current,
          contentKey,
          displayText,
          normalizedText: displayText,
          language,
          note,
          updatedAt: now,
        };
        await this.database.lexicalUnits.put(lexicalUnit);

        if (changes.occurrenceId !== undefined && changes.context !== undefined) {
          const occurrence = await this.database.occurrences.get(changes.occurrenceId);
          if (!occurrence || occurrence.lexicalUnitId !== id) {
            throw new Error("The selected context no longer belongs to this item.");
          }

          await this.database.occurrences.update(occurrence.id, {
            context: normalizeText(changes.context).slice(0, 800),
          });
        }
      },
    );

    const occurrences = await this.database.occurrences
      .where("lexicalUnitId")
      .equals(id)
      .sortBy("capturedAt");

    return { lexicalUnit, occurrences };
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
