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

const LEGACY_V2_SCHEMA = {
  lexicalUnits: "&id, &contentKey, status, updatedAt",
  occurrences: "&id, lexicalUnitId, normalizedSurfaceText, capturedAt",
} as const;

const LEGACY_V3_SCHEMA = {
  lexicalUnits: "&id, &contentKey, status, updatedAt",
  occurrences: "&id, lexicalUnitId, normalizedSurfaceText, capturedAt",
  exportBindings: "&lexicalUnitId, profileId, ankiNoteId",
} as const;

const LEGACY_V4_SCHEMA = {
  lexicalUnits: "&id, &contentKey, status, updatedAt",
  occurrences: "&id, lexicalUnitId, normalizedSurfaceText, capturedAt",
  exportBindings: "&lexicalUnitId, profileId, state, ankiNoteId",
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
      state: "exported",
      ankiNoteId: 4242,
      updatedAt: legacyUnit.updatedAt,
    });

    const listed = await new CaptureRepository(current).list();
    expect(listed[0]?.lexicalUnit).toEqual(expectedUnit);
    expect(listed[0]?.occurrences).toEqual([expectedOccurrence]);

    current.close();
  });

  it("migrates a frozen v2 exported note into an export binding without changing note identity", async () => {
    const name = `collector-v2-migration-${crypto.randomUUID()}`;
    databaseNames.push(name);

    const unit: LexicalUnit = {
      id: "legacy-v2-unit",
      contentKey: "he::שלום",
      canonicalText: "שלום",
      normalizedCanonicalText: "שלום",
      language: "he",
      note: "",
      status: "ready",
      createdAt: "2026-08-01T10:00:00Z",
      updatedAt: "2026-08-02T10:00:00Z",
      ankiNoteId: 9191,
    };
    const occurrence: Occurrence = {
      id: "legacy-v2-occ",
      lexicalUnitId: unit.id,
      surfaceText: "שלום",
      normalizedSurfaceText: "שלום",
      context: "שלום עולם",
      source: {
        kind: "duolingo",
        adapter: "duolingo-visible-backfill",
        url: "https://www.duolingo.com/lesson",
        title: "Duolingo",
      },
      capturedAt: "2026-08-01T10:00:00Z",
    };

    const legacy = new Dexie(name);
    legacy.version(2).stores(LEGACY_V2_SCHEMA);
    await legacy.open();
    await legacy.table<LexicalUnit>("lexicalUnits").add(unit);
    await legacy.table<Occurrence>("occurrences").add(occurrence);
    legacy.close();

    const current = new CollectorDatabase(name);
    await current.open();

    expect(await current.lexicalUnits.get(unit.id)).toEqual(unit);
    expect(await current.exportBindings.get(unit.id)).toEqual({
      lexicalUnitId: unit.id,
      profileId: LEGACY_DEFAULT_PROFILE_ID,
      state: "exported",
      ankiNoteId: 9191,
      updatedAt: unit.updatedAt,
    });

    current.close();
  });

  it("migrates pre-state v3 bindings conservatively to reserved/exported lifecycle states", async () => {
    const name = `collector-v3-binding-state-${crypto.randomUUID()}`;
    databaseNames.push(name);

    const legacy = new Dexie(name);
    legacy.version(3).stores(LEGACY_V3_SCHEMA);
    await legacy.open();
    await legacy.table("exportBindings").bulkAdd([
      {
        lexicalUnitId: "reserved-unit",
        profileId: "he-profile",
        deckName: "Hebrew RU",
        modelName: "Collector Basic",
        updatedAt: "2026-09-20T10:00:00Z",
      },
      {
        lexicalUnitId: "exported-unit",
        profileId: "he-profile",
        ankiNoteId: 5151,
        deckName: "Hebrew RU",
        modelName: "Collector Basic",
        updatedAt: "2026-09-20T10:00:00Z",
      },
    ]);
    legacy.close();

    const current = new CollectorDatabase(name);
    await current.open();

    const reserved = await current.exportBindings.get("reserved-unit");
    expect(reserved).toMatchObject({ state: "reserved" });
    expect(reserved).not.toHaveProperty("ankiNoteId");
    expect(await current.exportBindings.get("exported-unit")).toMatchObject({
      state: "exported",
      ankiNoteId: 5151,
    });

    current.close();
  });


  it("migrates the frozen v4 unique-canonical schema to v5 without changing ids or bindings", async () => {
    const name = `collector-v4-identity-migration-${crypto.randomUUID()}`;
    databaseNames.push(name);

    const unit: LexicalUnit = {
      id: "v4-unit",
      contentKey: "es::banco",
      canonicalText: "banco",
      normalizedCanonicalText: "banco",
      language: "es",
      note: "financial sense",
      status: "ready",
      createdAt: "2026-09-24T10:00:00Z",
      updatedAt: "2026-09-25T10:00:00Z",
      ankiNoteId: 6161,
    };
    const occurrence: Occurrence = {
      id: "v4-occurrence",
      lexicalUnitId: unit.id,
      surfaceText: "banco",
      normalizedSurfaceText: "banco",
      context: "El banco aprobó el préstamo.",
      source: {
        kind: "web",
        adapter: "generic-web",
        url: "https://example.com/bank",
        title: "Bank example",
      },
      capturedAt: "2026-09-24T10:00:00Z",
    };
    const binding = {
      lexicalUnitId: unit.id,
      profileId: "es-profile",
      state: "exported",
      ankiNoteId: 6161,
      deckName: "Spanish RU",
      deckId: "2",
      modelName: "Collector Basic",
      modelId: "10",
      updatedAt: "2026-09-25T10:00:00Z",
    };

    const legacy = new Dexie(name);
    legacy.version(4).stores(LEGACY_V4_SCHEMA);
    await legacy.open();
    await legacy.table<LexicalUnit>("lexicalUnits").add(unit);
    await legacy.table<Occurrence>("occurrences").add(occurrence);
    await legacy.table("exportBindings").add(binding);
    legacy.close();

    const current = new CollectorDatabase(name);
    await current.open();

    expect(await current.lexicalUnits.get(unit.id)).toEqual(unit);
    expect(await current.occurrences.get(occurrence.id)).toEqual(occurrence);
    expect(await current.exportBindings.get(unit.id)).toEqual(binding);

    const splitIdentity: LexicalUnit = {
      ...unit,
      id: "v5-same-canonical-unit",
      note: "river sense",
      status: "inbox",
      ankiNoteId: undefined,
      createdAt: "2026-09-26T00:00:00Z",
      updatedAt: "2026-09-26T00:00:00Z",
    };
    await current.lexicalUnits.add(splitIdentity);

    const sameCanonical = await current.lexicalUnits.where("contentKey").equals("es::banco").toArray();
    expect(sameCanonical.map((value) => value.id).sort()).toEqual(
      ["v4-unit", "v5-same-canonical-unit"].sort(),
    );

    current.close();
  });

});
