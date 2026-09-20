import Dexie, { type EntityTable } from "dexie";
import {
  LEGACY_DEFAULT_PROFILE_ID,
  type ExportBinding,
  type LexicalUnit,
  type Occurrence,
} from "../core/types";
import { normalizeIdentityText } from "../core/normalize";

interface LegacyLexicalUnitV1 {
  id: string;
  displayText: string;
  normalizedText: string;
}

interface LegacyOccurrenceV1 {
  id: string;
  lexicalUnitId: string;
}

export class CollectorDatabase extends Dexie {
  lexicalUnits!: EntityTable<LexicalUnit, "id">;
  occurrences!: EntityTable<Occurrence, "id">;
  exportBindings!: EntityTable<ExportBinding, "lexicalUnitId">;

  constructor(name = "anki-cards-collector") {
    super(name);

    this.version(1).stores({
      lexicalUnits: "&id, &contentKey, status, updatedAt",
      occurrences: "&id, lexicalUnitId, capturedAt",
    });

    this.version(2).stores({
      lexicalUnits: "&id, &contentKey, status, updatedAt",
      occurrences: "&id, lexicalUnitId, normalizedSurfaceText, capturedAt",
    }).upgrade(async (transaction) => {
      const legacyUnits = await transaction.table("lexicalUnits").toArray() as LegacyLexicalUnitV1[];
      const legacyById = new Map(legacyUnits.map((unit) => [unit.id, unit]));

      await transaction.table("lexicalUnits").toCollection().modify((value: Record<string, unknown>) => {
        const displayText = String(value.displayText ?? "");
        value.canonicalText = displayText;
        value.normalizedCanonicalText = normalizeIdentityText(displayText);
        delete value.displayText;
        delete value.normalizedText;
      });

      await transaction.table("occurrences").toCollection().modify((value: Record<string, unknown>) => {
        const occurrence = value as unknown as LegacyOccurrenceV1;
        const legacyUnit = legacyById.get(occurrence.lexicalUnitId);
        const surfaceText = legacyUnit?.displayText ?? "";
        value.surfaceText = surfaceText;
        value.normalizedSurfaceText = normalizeIdentityText(surfaceText);
      });
    });

    this.version(3).stores({
      lexicalUnits: "&id, &contentKey, status, updatedAt",
      occurrences: "&id, lexicalUnitId, normalizedSurfaceText, capturedAt",
      exportBindings: "&lexicalUnitId, profileId, ankiNoteId",
    }).upgrade(async (transaction) => {
      const units = await transaction.table("lexicalUnits").toArray() as LexicalUnit[];
      const bindings = units.flatMap((unit): ExportBinding[] =>
        unit.ankiNoteId === undefined
          ? []
          : [{
              lexicalUnitId: unit.id,
              profileId: LEGACY_DEFAULT_PROFILE_ID,
              state: "exported",
              ankiNoteId: unit.ankiNoteId,
              updatedAt: unit.updatedAt,
            }]
      );

      if (bindings.length > 0) {
        await transaction.table("exportBindings").bulkPut(bindings);
      }
    });

    this.version(4).stores({
      lexicalUnits: "&id, &contentKey, status, updatedAt",
      occurrences: "&id, lexicalUnitId, normalizedSurfaceText, capturedAt",
      exportBindings: "&lexicalUnitId, profileId, state, ankiNoteId",
    }).upgrade(async (transaction) => {
      await transaction.table("exportBindings").toCollection().modify(
        (value: Record<string, unknown>) => {
          if (
            value.state !== "override"
            && value.state !== "reserved"
            && value.state !== "exported"
          ) {
            value.state = value.ankiNoteId === undefined ? "reserved" : "exported";
          }
        },
      );
    });
  }
}

export const db = new CollectorDatabase();
