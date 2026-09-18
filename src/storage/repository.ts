import type { CaptureDraft, CollectedItem, LexicalUnit, Occurrence, ReviewStatus } from "../core/types";
import { makeContentKey, normalizeText } from "../core/normalize";
import { CollectorDatabase, db as defaultDb } from "./database";

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
