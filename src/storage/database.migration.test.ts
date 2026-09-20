import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { LEGACY_DEFAULT_PROFILE_ID, type LexicalUnit, type Occurrence } from "../core/types";
import { CollectorDatabase } from "./database";
import { CaptureRepository } from "./repository";

const LEGACY_V1_SCHEMA = {
  lexicalUnits: "&id, &contentKey, status, updatedAt",
  occurrences: "&id, lexicalUnitId, capturedAt",
} as const;

interface LegacyLexicalUnitV1 {
  id: string;
  contentKey: string;
  displayText: string;
  normalizedText: string;
  language: string;
  note: string;
  status: "inbox" | "ready" | "archived";
  createdAt: string;
  updatedAt: string;
  ankiNoteId?: number;
}

interface LegacyOccurrenceV1 {
  id: string;
  lexicalUnitId: string;
  context: string;
  source: {
    kind: "web" | "duolingo";
    adapter: string;
    url: string;
    title: string;
  };
  capturedAt: string;
}

describe("CollectorDatabase migration baseline", () => {
  const databaseNames: string[] = [];

  afterEach(async () => {
    await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)));
  });

  it("migrates the frozen v1 corpus without losing identity, state, or occurrences", async () => {
    const name = `collector-v1-migration-${crypto.randomUUID()}`;
    databaseNames.push(name);

    const legacyUnit: LegacyLexicalUnitV1 = {
      id: "legacy-unit-1",
      contentKey: "es::aunque",
      displayText: "aunque",
      normalizedText: "aunque",
      language: "es",
      note: "Legacy learner note.",
      status: "ready",
      createdAt: "2026-01-10T10:00:00Z",
      updatedAt: "2026-01-12T12:00:00Z",
      ankiNoteId: 4242,
    };
    const legacyOccurrence: LegacyOccurrenceV1 = {
      id: "legacy-occurrence-1",
      lexicalUnitId: legacyUnit.id,
      context: "Aunque llueva, voy.",
      source: {
        kind: "web",
        adapter: "generic-web",
        url: "https://example.com/article",
        title: "Legacy example",
      },
      capturedAt: "2026-01-10T10:00:00Z",
    };

    const legacy = new Dexie(name);
    legacy.version(1).stores(LEGACY_V1_SCHEMA);
    await legacy.open();
    await legacy.table<LegacyLexicalUnitV1>("lexicalUnits").add(legacyUnit);
    await legacy.table<LegacyOccurrenceV1>("occurrences").add(legacyOccurrence);
    legacy.close();

    const current = new CollectorDatabase(name);
    await current.open();

    const expectedUnit: LexicalUnit = {
      id: legacyUnit.id,
      contentKey: legacyUnit.contentKey,
      canonicalText: "aunque",
      normalizedCanonicalText: "aunque",
      language: "es",
      note: legacyUnit.note,
      status: "ready",
      createdAt: legacyUnit.createdAt,
      updatedAt: legacyUnit.updatedAt,
      ankiNoteId: 4242,
    };
    const expectedOccurrence: Occurrence = {
      id: legacyOccurrence.id,
      lexicalUnitId: legacyUnit.id,
      surfaceText: "aunque",
      normalizedSurfaceText: "aunque",
      context: legacyOccurrence.context,
      source: legacyOccurrence.source,
      capturedAt: legacyOccurrence.capturedAt,
    };

    expect(await current.lexicalUnits.get(legacyUnit.id)).toEqual(expectedUnit);
    expect(await current.occurrences.get(legacyOccurrence.id)).toEqual(expectedOccurrence);
    expect(await current.exportBindings.get(legacyUnit.id)).toEqual({
      lexicalUnitId: legacyUnit.id,
      profileId: LEGACY_DEFAULT_PROFILE_ID,
      ankiNoteId: 4242,
      updatedAt: legacyUnit.updatedAt,
    });

    const listed = await new CaptureRepository(current).list();
    expect(listed[0]?.lexicalUnit).toEqual(expectedUnit);
    expect(listed[0]?.occurrences).toEqual([expectedOccurrence]);

    current.close();
  });
});
