import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import type { LexicalUnit, Occurrence } from "../core/types";
import { CollectorDatabase } from "./database";
import { CaptureRepository } from "./repository";

const LEGACY_V1_SCHEMA = {
  lexicalUnits: "&id, &contentKey, status, updatedAt",
  occurrences: "&id, lexicalUnitId, capturedAt",
} as const;

describe("CollectorDatabase migration baseline", () => {
  const databaseNames: string[] = [];

  afterEach(async () => {
    await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)));
  });

  it("opens a frozen v1 corpus without losing identity, state, or occurrences", async () => {
    const name = `collector-v1-migration-${crypto.randomUUID()}`;
    databaseNames.push(name);

    const lexicalUnit: LexicalUnit = {
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
    const occurrence: Occurrence = {
      id: "legacy-occurrence-1",
      lexicalUnitId: lexicalUnit.id,
      context: "Aunque llueva, voy.",
      source: {
        kind: "web",
        adapter: "generic-web",
        url: "https://example.com/article",
        title: "Legacy example",
      },
      capturedAt: "2026-01-10T10:00:00Z",
    };

    // This database is deliberately created without CollectorDatabase.
    // Keep the literal v1 schema stable when future production versions are added.
    const legacy = new Dexie(name);
    legacy.version(1).stores(LEGACY_V1_SCHEMA);
    await legacy.open();
    await legacy.table<LexicalUnit>("lexicalUnits").add(lexicalUnit);
    await legacy.table<Occurrence>("occurrences").add(occurrence);
    legacy.close();

    const current = new CollectorDatabase(name);
    await current.open();

    expect(await current.lexicalUnits.get(lexicalUnit.id)).toEqual(lexicalUnit);
    expect(await current.occurrences.get(occurrence.id)).toEqual(occurrence);

    const listed = await new CaptureRepository(current).list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.lexicalUnit).toEqual(lexicalUnit);
    expect(listed[0]?.occurrences).toEqual([occurrence]);

    current.close();
  });
});
