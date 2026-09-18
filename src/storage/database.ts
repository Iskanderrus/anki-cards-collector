import Dexie, { type EntityTable } from "dexie";
import type { LexicalUnit, Occurrence } from "../core/types";

export class CollectorDatabase extends Dexie {
  lexicalUnits!: EntityTable<LexicalUnit, "id">;
  occurrences!: EntityTable<Occurrence, "id">;

  constructor(name = "anki-cards-collector") {
    super(name);

    this.version(1).stores({
      lexicalUnits: "&id, &contentKey, status, updatedAt",
      occurrences: "&id, lexicalUnitId, capturedAt",
    });
  }
}

export const db = new CollectorDatabase();
