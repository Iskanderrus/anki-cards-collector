import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BackupDocument } from "../backup/format";
import { DEFAULT_SETTINGS } from "../settings";
import type { CaptureDraft } from "../core/types";
import { CollectorDatabase } from "./database";
import { CaptureRepository } from "./repository";

function draft(text: string, context: string): CaptureDraft {
  return {
    text,
    context,
    language: "es",
    capturedAt: new Date().toISOString(),
    source: {
      kind: "web",
      adapter: "generic-web",
      url: "https://example.com/article",
      title: "Example",
    },
  };
}

describe("CaptureRepository", () => {
  let database: CollectorDatabase;
  let repository: CaptureRepository;

  beforeEach(() => {
    database = new CollectorDatabase(`collector-test-${crypto.randomUUID()}`);
    repository = new CaptureRepository(database);
  });

  afterEach(async () => {
    database.close();
    await database.delete();
  });

  it("deduplicates the same canonical surface while keeping occurrences", async () => {
    await repository.capture(draft("tener ganas de", "Quiero tener ganas de salir."));
    await repository.capture(draft("  Tener  ganas de ", "Necesito tener ganas de cocinar."));

    const items = await repository.list();

    expect(items).toHaveLength(1);
    expect(items[0]?.occurrences).toHaveLength(2);
    expect(items[0]?.lexicalUnit.canonicalText).toBe("tener ganas de");
    expect(items[0]?.occurrences.map((occurrence) => occurrence.surfaceText)).toEqual([
      "tener ganas de",
      "Tener ganas de",
    ]);
  });

  it("keeps the observed form when the lexical unit is canonicalized", async () => {
    const captured = await repository.capture(
      draft("tengo ganas de", "Hoy tengo ganas de salir a caminar."),
    );
    const occurrence = captured.occurrences[0]!;

    const updated = await repository.update(captured.lexicalUnit.id, {
      canonicalText: "tener ganas de",
      language: "es",
      note: "",
      occurrenceId: occurrence.id,
      surfaceText: "tengo ganas de",
      context: occurrence.context,
    });

    expect(updated.lexicalUnit.id).toBe(captured.lexicalUnit.id);
    expect(updated.lexicalUnit.canonicalText).toBe("tener ganas de");
    expect(updated.lexicalUnit.contentKey).toBe("es::tener ganas de");
    expect(updated.occurrences[0]?.surfaceText).toBe("tengo ganas de");
    expect(updated.occurrences[0]?.normalizedSurfaceText).toBe("tengo ganas de");
  });

  it("routes a repeated observed form back to its canonicalized unit", async () => {
    const captured = await repository.capture(
      draft("tengo ganas de", "Hoy tengo ganas de salir."),
    );

    await repository.update(captured.lexicalUnit.id, {
      canonicalText: "tener ganas de",
      language: "es",
      note: "",
      occurrenceId: captured.occurrences[0]!.id,
      surfaceText: "tengo ganas de",
      context: "Hoy tengo ganas de salir.",
    });

    await repository.capture(
      draft("Tengo ganas de", "Otra vez tengo ganas de caminar."),
    );

    const items = await repository.list();
    expect(items).toHaveLength(1);
    expect(items[0]?.lexicalUnit.canonicalText).toBe("tener ganas de");
    expect(items[0]?.occurrences).toHaveLength(2);
  });

  it("consolidates compatible forms under one canonical unit and preserves an exported identity", async () => {
    const first = await repository.capture(draft("tengo ganas de", "Hoy tengo ganas de salir."));
    await repository.update(first.lexicalUnit.id, {
      canonicalText: "tener ganas de",
      language: "es",
      note: "Common construction.",
      occurrenceId: first.occurrences[0]!.id,
      surfaceText: "tengo ganas de",
      context: "Hoy tengo ganas de salir.",
    });
    await repository.setAnkiNoteId(first.lexicalUnit.id, 4242);

    const second = await repository.capture(draft("tenía ganas de", "Ayer tenía ganas de dormir."));
    const consolidated = await repository.update(second.lexicalUnit.id, {
      canonicalText: "tener ganas de",
      language: "es",
      note: "",
      occurrenceId: second.occurrences[0]!.id,
      surfaceText: "tenía ganas de",
      context: "Ayer tenía ganas de dormir.",
    });

    expect(consolidated.lexicalUnit.id).toBe(first.lexicalUnit.id);
    expect(consolidated.lexicalUnit.ankiNoteId).toBe(4242);
    expect(consolidated.lexicalUnit.status).toBe("inbox");
    expect(consolidated.occurrences.map((occurrence) => occurrence.surfaceText).sort()).toEqual([
      "tengo ganas de",
      "tenía ganas de",
    ]);
    expect(await repository.list()).toHaveLength(1);
  });

  it("preserves the edited exported identity when the existing canonical unit is unexported", async () => {
    const canonical = await repository.capture(draft("tener", "Quiero tener tiempo."));
    const observed = await repository.capture(draft("tengo", "Tengo tiempo."));
    await repository.setAnkiNoteId(observed.lexicalUnit.id, 777);

    const consolidated = await repository.update(observed.lexicalUnit.id, {
      canonicalText: "tener",
      language: "es",
      note: "",
      occurrenceId: observed.occurrences[0]!.id,
      surfaceText: "tengo",
      context: "Tengo tiempo.",
    });

    expect(consolidated.lexicalUnit.id).toBe(observed.lexicalUnit.id);
    expect(consolidated.lexicalUnit.ankiNoteId).toBe(777);
    expect(consolidated.occurrences).toHaveLength(2);
    expect(await database.lexicalUnits.get(canonical.lexicalUnit.id)).toBeUndefined();
  });

  it("refuses to consolidate units tied to different Anki notes", async () => {
    const canonical = await repository.capture(draft("tener", "Quiero tener tiempo."));
    const observed = await repository.capture(draft("tengo", "Tengo tiempo."));
    await repository.setAnkiNoteId(canonical.lexicalUnit.id, 100);
    await repository.setAnkiNoteId(observed.lexicalUnit.id, 200);

    await expect(repository.update(observed.lexicalUnit.id, {
      canonicalText: "tener",
      language: "es",
      note: "",
      occurrenceId: observed.occurrences[0]!.id,
      surfaceText: "tengo",
      context: "Tengo tiempo.",
    })).rejects.toThrow("different Anki notes");

    expect(await repository.list()).toHaveLength(2);
  });

  it("invalidates ready approval when study content is edited", async () => {
    const captured = await repository.capture(draft("aunque", "Aunque llueva, voy."));
    await repository.setStatus(captured.lexicalUnit.id, "ready");

    const updated = await repository.update(captured.lexicalUnit.id, {
      canonicalText: "aunque",
      language: "es",
      note: "although",
      occurrenceId: captured.occurrences[0]!.id,
      surfaceText: "aunque",
      context: "Aunque llueva, voy.",
    });

    expect(updated.lexicalUnit.status).toBe("inbox");
  });

  it("restores a current backup idempotently and skips duplicate occurrences", async () => {
    const backup: BackupDocument = {
      version: 3,
      exportedAt: "2026-09-19T10:00:00Z",
      settings: DEFAULT_SETTINGS,
      exportBindings: [],
      items: [{
        lexicalUnit: {
          id: "unit-restore",
          contentKey: "es::tener",
          canonicalText: "tener",
          normalizedCanonicalText: "tener",
          language: "es",
          note: "",
          status: "inbox",
          createdAt: "2026-09-18T10:00:00Z",
          updatedAt: "2026-09-18T10:00:00Z",
        },
        occurrences: [
          {
            id: "occ-restore-1",
            lexicalUnitId: "unit-restore",
            surfaceText: "tengo",
            normalizedSurfaceText: "tengo",
            context: "Tengo tiempo.",
            source: {
              kind: "web",
              adapter: "generic-web",
              url: "https://example.com/article",
              title: "Example",
            },
            capturedAt: "2026-09-18T10:00:00Z",
          },
          {
            id: "occ-restore-duplicate",
            lexicalUnitId: "unit-restore",
            surfaceText: "tengo",
            normalizedSurfaceText: "tengo",
            context: "Tengo tiempo.",
            source: {
              kind: "web",
              adapter: "generic-web",
              url: "https://example.com/article",
              title: "Example",
            },
            capturedAt: "2026-09-18T10:00:00Z",
          },
        ],
      }],
    };

    expect(await repository.previewRestore(backup)).toMatchObject({
      lexicalUnitsAdded: 1,
      occurrencesAdded: 1,
      occurrencesSkipped: 1,
      conflicts: [],
    });

    await repository.restoreBackup(backup);
    expect((await repository.list())[0]?.occurrences).toHaveLength(1);
  });

  it("persists and clears per-item export bindings independently of lexical identity", async () => {
    const captured = await repository.capture(draft("aunque", "Aunque llueva, voy."));
    await repository.setExportBinding({
      lexicalUnitId: captured.lexicalUnit.id,
      profileId: "es-profile",
      ankiNoteId: 4242,
      deckName: "Spanish RU",
      modelName: "Collector Basic",
    });

    expect(await repository.getExportBinding(captured.lexicalUnit.id)).toMatchObject({
      lexicalUnitId: captured.lexicalUnit.id,
      profileId: "es-profile",
      ankiNoteId: 4242,
      deckName: "Spanish RU",
      modelName: "Collector Basic",
    });

    await repository.clearExportBinding(captured.lexicalUnit.id);
    expect(await repository.getExportBinding(captured.lexicalUnit.id)).toBeNull();
    expect((await repository.list())[0]?.lexicalUnit.id).toBe(captured.lexicalUnit.id);
  });

  it("refuses canonical consolidation when units are pinned to different export profiles", async () => {
    const canonical = await repository.capture(draft("tener", "Quiero tener tiempo."));
    const observed = await repository.capture(draft("tengo", "Tengo tiempo."));

    await repository.setExportBinding({
      lexicalUnitId: canonical.lexicalUnit.id,
      profileId: "profile-a",
    });
    await repository.setExportBinding({
      lexicalUnitId: observed.lexicalUnit.id,
      profileId: "profile-b",
    });

    await expect(repository.update(observed.lexicalUnit.id, {
      canonicalText: "tener",
      language: "es",
      note: "",
      occurrenceId: observed.occurrences[0]!.id,
      surfaceText: "tengo",
      context: "Tengo tiempo.",
    })).rejects.toThrow("different export destinations");

    expect(await repository.list()).toHaveLength(2);
  });

  it("moves a compatible binding with the surviving lexical unit during consolidation", async () => {
    const canonical = await repository.capture(draft("tener", "Quiero tener tiempo."));
    const observed = await repository.capture(draft("tengo", "Tengo tiempo."));

    await repository.setExportBinding({
      lexicalUnitId: observed.lexicalUnit.id,
      profileId: "profile-a",
      ankiNoteId: 6060,
      deckName: "Spanish RU",
      modelName: "Collector Basic",
    });

    const consolidated = await repository.update(observed.lexicalUnit.id, {
      canonicalText: "tener",
      language: "es",
      note: "",
      occurrenceId: observed.occurrences[0]!.id,
      surfaceText: "tengo",
      context: "Tengo tiempo.",
    });

    expect(consolidated.lexicalUnit.id).toBe(observed.lexicalUnit.id);
    expect(await repository.getExportBinding(observed.lexicalUnit.id)).toMatchObject({
      profileId: "profile-a",
      ankiNoteId: 6060,
    });
    expect(await repository.getExportBinding(canonical.lexicalUnit.id)).toBeNull();
  });

  it("restores export bindings idempotently and rejects a conflicting local destination", async () => {
    const captured = await repository.capture(draft("aunque", "Aunque llueva, voy."));
    const backup: BackupDocument = {
      version: 3,
      exportedAt: "2026-09-20T10:00:00Z",
      settings: DEFAULT_SETTINGS,
      items: [captured],
      exportBindings: [{
        lexicalUnitId: captured.lexicalUnit.id,
        profileId: DEFAULT_SETTINGS.fallbackProfileId,
        ankiNoteId: 5151,
        deckName: "Collector Inbox",
        modelName: "Collector Basic",
        updatedAt: "2026-09-20T10:00:00Z",
      }],
    };

    expect(await repository.previewRestore(backup)).toMatchObject({
      exportBindingsAdded: 1,
      conflicts: [],
    });
    await repository.restoreBackup(backup);
    expect(await repository.previewRestore(backup)).toMatchObject({
      exportBindingsAdded: 0,
      exportBindingsSkipped: 1,
      conflicts: [],
    });

    await repository.setExportBinding({
      lexicalUnitId: captured.lexicalUnit.id,
      profileId: "other-profile",
      ankiNoteId: 9999,
      deckName: "Other",
      modelName: "Collector Basic",
    });
    const preview = await repository.previewRestore(backup);
    expect(preview.conflicts.join("\n")).toContain("Export binding conflict");
  });

  it("deleting a lexical unit also deletes its export binding", async () => {
    const captured = await repository.capture(draft("aunque", "Aunque llueva, voy."));
    await repository.setExportBinding({
      lexicalUnitId: captured.lexicalUnit.id,
      profileId: "profile-a",
    });

    await repository.remove(captured.lexicalUnit.id);
    expect(await repository.getExportBinding(captured.lexicalUnit.id)).toBeNull();
  });


  it("refuses consolidation when the same profile id has conflicting pinned destination snapshots", async () => {
    const canonical = await repository.capture(draft("tener", "Quiero tener tiempo."));
    const observed = await repository.capture(draft("tengo", "Tengo tiempo."));

    await repository.setExportBinding({
      lexicalUnitId: canonical.lexicalUnit.id,
      profileId: "profile-a",
      ankiNoteId: 1111,
      deckName: "Spanish Old",
      modelName: "Collector Basic",
    });
    await repository.setExportBinding({
      lexicalUnitId: observed.lexicalUnit.id,
      profileId: "profile-a",
      ankiNoteId: 1111,
      deckName: "Spanish New",
      modelName: "Collector Basic",
    });

    await expect(repository.update(observed.lexicalUnit.id, {
      canonicalText: "tener",
      language: "es",
      note: "",
      occurrenceId: observed.occurrences[0]!.id,
      surfaceText: "tengo",
      context: "Tengo tiempo.",
    })).rejects.toThrow("different export destinations");

    expect(await repository.list()).toHaveLength(2);
  });

});
