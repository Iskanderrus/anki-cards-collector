import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("READY_RECAPTURE_RETURNS_TO_INBOX for Ready and Archived items", async () => {
    const ready = await repository.capture(
      draft("aunque", "Aunque llueva, voy a caminar porque quiero practicar."),
    );
    await repository.setStatus(ready.lexicalUnit.id, "ready");
    const readyRecaptured = await repository.capture(
      draft("aunque", "Aunque llueva mucho, todavía voy a caminar por el centro."),
    );
    expect(readyRecaptured.lexicalUnit.id).toBe(ready.lexicalUnit.id);
    expect(readyRecaptured.lexicalUnit.status).toBe("inbox");
    expect(readyRecaptured.occurrences).toHaveLength(2);

    const archived = await repository.capture(
      draft("sin embargo", "Sin embargo, seguimos estudiando cada día."),
    );
    await repository.setStatus(archived.lexicalUnit.id, "archived");
    const archivedRecaptured = await repository.capture(
      draft("sin embargo", "Sin embargo, hoy tenemos un contexto bastante mejor."),
    );
    expect(archivedRecaptured.lexicalUnit.id).toBe(archived.lexicalUnit.id);
    expect(archivedRecaptured.lexicalUnit.status).toBe("inbox");
    expect(archivedRecaptured.occurrences).toHaveLength(2);
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


  it("allows a canonical edit to match another unit without implicit merge", async () => {
    const first = await repository.capture(draft("tener", "Quiero tener tiempo."));
    const second = await repository.capture(draft("tengo", "Tengo tiempo."));

    const updated = await repository.update(second.lexicalUnit.id, {
      canonicalText: "tener",
      language: "es",
      note: "separate sense",
      occurrenceId: second.occurrences[0]!.id,
      surfaceText: "tengo",
      context: "Tengo tiempo.",
    });

    const items = await repository.list();
    expect(items).toHaveLength(2);
    expect(updated.lexicalUnit.id).toBe(second.lexicalUnit.id);
    expect(items.map((item) => item.lexicalUnit.id).sort()).toEqual(
      [first.lexicalUnit.id, second.lexicalUnit.id].sort(),
    );
    expect(items.every((item) => item.lexicalUnit.contentKey === "es::tener")).toBe(true);
  });


  it("explicit merge preserves the exported lexical identity and all occurrence ids", async () => {
    const unexported = await repository.capture(draft("tener", "Quiero tener tiempo."));
    const exported = await repository.capture(draft("tengo", "Tengo tiempo."));
    await repository.setExportBinding({
      lexicalUnitId: exported.lexicalUnit.id,
      profileId: "profile-a",
      state: "exported",
      ankiNoteId: 777,
      deckName: "Spanish RU",
      deckId: "2",
      modelName: "Collector Basic",
      modelId: "10",
    });
    const occurrenceIds = [
      ...unexported.occurrences.map((occurrence) => occurrence.id),
      ...exported.occurrences.map((occurrence) => occurrence.id),
    ].sort();

    const preview = await repository.previewMerge(unexported.lexicalUnit.id, exported.lexicalUnit.id);
    expect(preview.survivingLexicalUnitId).toBe(exported.lexicalUnit.id);
    expect(preview.blocked).toBe(false);

    const merged = await repository.mergeLexicalUnits({
      sourceId: unexported.lexicalUnit.id,
      targetId: exported.lexicalUnit.id,
      expectedSnapshotToken: preview.snapshotToken,
      canonicalText: "tener",
      note: "chosen note",
    });

    expect(merged.survivingLexicalUnitId).toBe(exported.lexicalUnit.id);
    expect(merged.item.lexicalUnit.status).toBe("inbox");
    expect(merged.item.lexicalUnit.note).toBe("chosen note");
    expect(merged.item.occurrences.map((occurrence) => occurrence.id).sort()).toEqual(occurrenceIds);
    expect(await repository.getExportBinding(exported.lexicalUnit.id)).toMatchObject({
      profileId: "profile-a",
      state: "exported",
      ankiNoteId: 777,
      deckId: "2",
      modelId: "10",
    });
    expect(await repository.list()).toHaveLength(1);
  });


  it("blocks explicit merge for different Anki note identities without mutating either unit", async () => {
    const first = await repository.capture(draft("tener", "Quiero tener tiempo."));
    const second = await repository.capture(draft("tengo", "Tengo tiempo."));
    await repository.setExportBinding({
      lexicalUnitId: first.lexicalUnit.id,
      profileId: "profile-a",
      state: "exported",
      ankiNoteId: 100,
      deckName: "Spanish RU",
      modelName: "Collector Basic",
    });
    await repository.setExportBinding({
      lexicalUnitId: second.lexicalUnit.id,
      profileId: "profile-a",
      state: "exported",
      ankiNoteId: 200,
      deckName: "Spanish RU",
      modelName: "Collector Basic",
    });

    const preview = await repository.previewMerge(first.lexicalUnit.id, second.lexicalUnit.id);
    expect(preview.blocked).toBe(true);
    expect(preview.conflictReason).toContain("different Anki notes");
    await expect(repository.mergeLexicalUnits({
      sourceId: first.lexicalUnit.id,
      targetId: second.lexicalUnit.id,
      expectedSnapshotToken: preview.snapshotToken,
      canonicalText: "tener",
      note: "",
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
      version: 4,
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
      state: "exported",
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


  it("blocks explicit merge when units have different export bindings", async () => {
    const first = await repository.capture(draft("tener", "Quiero tener tiempo."));
    const second = await repository.capture(draft("tengo", "Tengo tiempo."));
    await repository.setExportBinding({
      lexicalUnitId: first.lexicalUnit.id,
      profileId: "profile-a",
      state: "override",
    });
    await repository.setExportBinding({
      lexicalUnitId: second.lexicalUnit.id,
      profileId: "profile-b",
      state: "override",
    });

    const preview = await repository.previewMerge(first.lexicalUnit.id, second.lexicalUnit.id);
    expect(preview.blocked).toBe(true);
    expect(preview.conflictReason).toContain("different Anki destination bindings");
    expect(await repository.list()).toHaveLength(2);
  });


  it("blocks explicit merge when same-name bindings pin different model ids", async () => {
    const first = await repository.capture(draft("tener", "Quiero tener tiempo."));
    const second = await repository.capture(draft("tengo", "Tengo tiempo."));
    await repository.setExportBinding({
      lexicalUnitId: first.lexicalUnit.id,
      profileId: "profile-a",
      state: "override",
      deckName: "Spanish RU",
      deckId: "2",
      modelName: "Spanish Existing",
      modelId: "11",
    });
    await repository.setExportBinding({
      lexicalUnitId: second.lexicalUnit.id,
      profileId: "profile-a",
      state: "override",
      deckName: "Spanish RU",
      deckId: "2",
      modelName: "Spanish Existing",
      modelId: "999",
    });

    const preview = await repository.previewMerge(first.lexicalUnit.id, second.lexicalUnit.id);
    expect(preview.blocked).toBe(true);
    expect(preview.conflictReason).toContain("different Anki destination bindings");
  });


  it("explicit merge keeps one compatible binding on the surviving unit", async () => {
    const unexported = await repository.capture(draft("tener", "Quiero tener tiempo."));
    const exported = await repository.capture(draft("tengo", "Tengo tiempo."));
    await repository.setExportBinding({
      lexicalUnitId: exported.lexicalUnit.id,
      profileId: "profile-a",
      state: "exported",
      ankiNoteId: 6060,
      deckName: "Spanish RU",
      modelName: "Collector Basic",
    });

    const preview = await repository.previewMerge(unexported.lexicalUnit.id, exported.lexicalUnit.id);
    const result = await repository.mergeLexicalUnits({
      sourceId: unexported.lexicalUnit.id,
      targetId: exported.lexicalUnit.id,
      expectedSnapshotToken: preview.snapshotToken,
      canonicalText: "tener",
      note: "",
    });

    expect(result.survivingLexicalUnitId).toBe(exported.lexicalUnit.id);
    expect(await repository.getExportBinding(exported.lexicalUnit.id)).toMatchObject({
      profileId: "profile-a",
      ankiNoteId: 6060,
    });
    expect(await repository.getExportBinding(unexported.lexicalUnit.id)).toBeNull();
  });

  it("restores export bindings idempotently and rejects a conflicting local destination", async () => {
    const captured = await repository.capture(draft("aunque", "Aunque llueva, voy."));
    const backup: BackupDocument = {
      version: 4,
      exportedAt: "2026-09-20T10:00:00Z",
      settings: DEFAULT_SETTINGS,
      items: [captured],
      exportBindings: [{
        lexicalUnitId: captured.lexicalUnit.id,
        profileId: DEFAULT_SETTINGS.fallbackProfileId,
        state: "exported",
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
      state: "exported",
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
      state: "override",
    });

    await repository.remove(captured.lexicalUnit.id);
    expect(await repository.getExportBinding(captured.lexicalUnit.id)).toBeNull();
  });



  it("blocks explicit merge for conflicting pinned destination snapshots", async () => {
    const first = await repository.capture(draft("tener", "Quiero tener tiempo."));
    const second = await repository.capture(draft("tengo", "Tengo tiempo."));
    await repository.setExportBinding({
      lexicalUnitId: first.lexicalUnit.id,
      profileId: "profile-a",
      state: "exported",
      ankiNoteId: 1111,
      deckName: "Spanish Old",
      modelName: "Collector Basic",
    });
    await repository.setExportBinding({
      lexicalUnitId: second.lexicalUnit.id,
      profileId: "profile-a",
      state: "exported",
      ankiNoteId: 1111,
      deckName: "Spanish New",
      modelName: "Collector Basic",
    });

    const preview = await repository.previewMerge(first.lexicalUnit.id, second.lexicalUnit.id);
    expect(preview.blocked).toBe(true);
    expect(preview.conflictReason).toContain("different Anki destination bindings");
  });

  it("refuses deletion while a reserved Anki identity is awaiting reconciliation", async () => {
    const captured = await repository.capture(draft("aunque", "Aunque llueva, voy."));
    await repository.setExportBinding({
      lexicalUnitId: captured.lexicalUnit.id,
      profileId: "es-profile",
      state: "reserved",
      deckName: "Spanish RU",
      modelName: "Collector Basic",
    });

    await expect(
      repository.remove(captured.lexicalUnit.id),
    ).rejects.toThrow("awaiting reconciliation");

    const items = await repository.list();
    expect(items).toHaveLength(1);
    expect(items[0]?.lexicalUnit.id).toBe(captured.lexicalUnit.id);
    expect(await repository.getExportBinding(captured.lexicalUnit.id)).toMatchObject({
      lexicalUnitId: captured.lexicalUnit.id,
      state: "reserved",
      deckName: "Spanish RU",
      modelName: "Collector Basic",
    });
  });


  it("blocks explicit merge when one side has a reserved external identity", async () => {
    const reserved = await repository.capture(draft("tengo", "Tengo tiempo."));
    const other = await repository.capture(draft("tener", "Quiero tener tiempo."));
    await repository.setExportBinding({
      lexicalUnitId: reserved.lexicalUnit.id,
      profileId: "es-profile",
      state: "reserved",
      deckName: "Spanish RU",
      modelName: "Collector Basic",
    });

    const preview = await repository.previewMerge(reserved.lexicalUnit.id, other.lexicalUnit.id);
    expect(preview.blocked).toBe(true);
    expect(preview.conflictReason).toContain("reserved");
    expect(await repository.list()).toHaveLength(2);
  });


  it("blocks explicit merge when both units hold reserved identities", async () => {
    const first = await repository.capture(draft("tengo", "Tengo tiempo."));
    const second = await repository.capture(draft("tener", "Quiero tener tiempo."));
    for (const lexicalUnitId of [first.lexicalUnit.id, second.lexicalUnit.id]) {
      await repository.setExportBinding({
        lexicalUnitId,
        profileId: "es-profile",
        state: "reserved",
        deckName: "Spanish RU",
        modelName: "Collector Basic",
      });
    }

    const preview = await repository.previewMerge(first.lexicalUnit.id, second.lexicalUnit.id);
    expect(preview.blocked).toBe(true);
    expect(preview.conflictReason).toContain("reserved");
    expect(await repository.listExportBindings()).toHaveLength(2);
  });

  it("allows a reserved item to be edited when its Collector ID is retained", async () => {
    const captured = await repository.capture(draft("tengo", "Tengo tiempo."));
    await repository.setExportBinding({
      lexicalUnitId: captured.lexicalUnit.id,
      profileId: "es-profile",
      state: "reserved",
      deckName: "Spanish RU",
      modelName: "Collector Basic",
    });

    const updated = await repository.update(captured.lexicalUnit.id, {
      canonicalText: "tener ganas",
      language: "es",
      note: "Edited without collision.",
      occurrenceId: captured.occurrences[0]!.id,
      surfaceText: "tengo",
      context: "Tengo tiempo.",
    });

    expect(updated.lexicalUnit.id).toBe(captured.lexicalUnit.id);
    expect(await repository.getExportBinding(captured.lexicalUnit.id)).toMatchObject({
      lexicalUnitId: captured.lexicalUnit.id,
      state: "reserved",
    });
  });


  it("prevents direct clearing or rerouting of a reserved binding at repository boundary", async () => {
    const captured = await repository.capture(draft("aunque", "Aunque llueva, voy."));
    await repository.setExportBinding({
      lexicalUnitId: captured.lexicalUnit.id,
      profileId: "es-profile",
      state: "reserved",
      deckName: "Spanish RU",
      modelName: "Collector Basic",
    });

    await expect(
      repository.clearExportBinding(captured.lexicalUnit.id),
    ).rejects.toThrow("Cannot clear a reserved Anki identity");

    await expect(repository.setExportBinding({
      lexicalUnitId: captured.lexicalUnit.id,
      profileId: "other-profile",
      state: "override",
      deckName: "Other Deck",
      modelName: "Collector Basic",
    })).rejects.toThrow("Cannot change a reserved Anki identity");

    expect(await repository.getExportBinding(captured.lexicalUnit.id)).toMatchObject({
      profileId: "es-profile",
      state: "reserved",
      deckName: "Spanish RU",
    });
  });

  it("allows a reserved binding to reconcile to exported only on the same destination identity", async () => {
    const captured = await repository.capture(draft("aunque", "Aunque llueva, voy."));
    await repository.setExportBinding({
      lexicalUnitId: captured.lexicalUnit.id,
      profileId: "es-profile",
      state: "reserved",
      deckName: "Spanish RU",
      deckId: "2",
      modelName: "Collector Basic",
      modelId: "11",
    });

    await repository.setExportBinding({
      lexicalUnitId: captured.lexicalUnit.id,
      profileId: "es-profile",
      state: "exported",
      ankiNoteId: 4242,
      deckName: "Spanish RU",
      deckId: "2",
      modelName: "Collector Basic",
      modelId: "11",
    });

    expect(await repository.getExportBinding(captured.lexicalUnit.id)).toMatchObject({
      profileId: "es-profile",
      state: "exported",
      ankiNoteId: 4242,
      deckName: "Spanish RU",
      deckId: "2",
      modelName: "Collector Basic",
      modelId: "11",
    });
  });

  it("rejects reserved reconciliation when a same-name Anki object has a different pinned id", async () => {
    const captured = await repository.capture(draft("aunque", "Aunque llueva, voy."));
    await repository.setExportBinding({
      lexicalUnitId: captured.lexicalUnit.id,
      profileId: "es-profile",
      state: "reserved",
      deckName: "Spanish RU",
      deckId: "2",
      modelName: "Hebrew Existing",
      modelId: "11",
    });

    await expect(repository.setExportBinding({
      lexicalUnitId: captured.lexicalUnit.id,
      profileId: "es-profile",
      state: "exported",
      ankiNoteId: 4242,
      deckName: "Spanish RU",
      deckId: "2",
      modelName: "Hebrew Existing",
      modelId: "999",
    })).rejects.toThrow("Cannot change a reserved Anki identity");

    expect(await repository.getExportBinding(captured.lexicalUnit.id)).toMatchObject({
      state: "reserved",
      deckId: "2",
      modelId: "11",
    });
  });


  it("groups observed forms with counts without rewriting occurrence evidence", async () => {
    const captured = await repository.capture(draft("Tengo", "Tengo tiempo."));
    await repository.capture(draft("tengo", "Hoy tengo tiempo."));
    await repository.update(captured.lexicalUnit.id, {
      canonicalText: "tener",
      language: "es",
      note: "",
      occurrenceId: captured.occurrences[0]!.id,
      surfaceText: "Tengo",
      context: "Tengo tiempo.",
    });

    const groups = await repository.listObservedForms(captured.lexicalUnit.id);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      normalizedSurfaceText: "tengo",
      count: 2,
      surfaceForms: ["Tengo", "tengo"],
    });
    expect(groups[0]?.occurrences.map((occurrence) => occurrence.context)).toEqual([
      "Tengo tiempo.",
      "Hoy tengo tiempo.",
    ]);
  });


  it("previews a canonical rename without mutating identity", async () => {
    const captured = await repository.capture(draft("tengo", "Tengo tiempo."));
    await repository.setStatus(captured.lexicalUnit.id, "ready");

    const preview = await repository.previewCanonicalization(
      captured.lexicalUnit.id,
      "tener",
      "es",
    );

    expect(preview).toMatchObject({
      kind: "rename",
      currentId: captured.lexicalUnit.id,
      currentCanonicalText: "tengo",
      requestedCanonicalText: "tener",
      requestedLanguage: "es",
      currentOccurrenceCount: 1,
      willReturnToInbox: true,
      sameCanonicalCandidates: [],
    });
    expect((await repository.list())[0]?.lexicalUnit.canonicalText).toBe("tengo");
    expect((await repository.list())[0]?.lexicalUnit.status).toBe("ready");
  });


  it("canonicalization preview reports same-canonical candidates but never implies merge", async () => {
    const canonical = await repository.capture(draft("tener", "Quiero tener tiempo."));
    const observed = await repository.capture(draft("tengo", "Tengo tiempo."));
    await repository.setExportBinding({
      lexicalUnitId: observed.lexicalUnit.id,
      profileId: "profile-a",
      state: "exported",
      ankiNoteId: 6060,
      deckName: "Spanish RU",
      modelName: "Collector Basic",
    });

    const preview = await repository.previewCanonicalization(
      observed.lexicalUnit.id,
      "tener",
      "es",
    );

    expect(preview.kind).toBe("rename");
    expect(preview.sameCanonicalCandidates).toEqual([{
      id: canonical.lexicalUnit.id,
      canonicalText: "tener",
      language: "es",
      status: "inbox",
      occurrenceCount: 1,
    }]);
    expect(await repository.list()).toHaveLength(2);
  });


  it("canonicalization remains an edit even when a possible merge would be blocked", async () => {
    const canonical = await repository.capture(draft("tener", "Quiero tener tiempo."));
    const observed = await repository.capture(draft("tengo", "Tengo tiempo."));
    await repository.setExportBinding({
      lexicalUnitId: canonical.lexicalUnit.id,
      profileId: "profile-a",
      state: "exported",
      ankiNoteId: 100,
      deckName: "Spanish RU",
      modelName: "Collector Basic",
    });
    await repository.setExportBinding({
      lexicalUnitId: observed.lexicalUnit.id,
      profileId: "profile-a",
      state: "exported",
      ankiNoteId: 200,
      deckName: "Spanish RU",
      modelName: "Collector Basic",
    });

    const preview = await repository.previewCanonicalization(
      observed.lexicalUnit.id,
      "tener",
      "es",
    );
    expect(preview.kind).toBe("rename");
    expect(preview.sameCanonicalCandidates[0]?.id).toBe(canonical.lexicalUnit.id);

    const updated = await repository.update(observed.lexicalUnit.id, {
      canonicalText: "tener",
      language: "es",
      note: "",
    });
    expect(updated.lexicalUnit.id).toBe(observed.lexicalUnit.id);
    expect(await repository.list()).toHaveLength(2);

    const mergePreview = await repository.previewMerge(
      observed.lexicalUnit.id,
      canonical.lexicalUnit.id,
    );
    expect(mergePreview.blocked).toBe(true);
    expect(mergePreview.conflictReason).toContain("different Anki notes");
  });


  it("merges two unexported units explicitly and keeps the source id deterministically", async () => {
    const first = await repository.capture(draft("banco", "El banco está abierto."));
    const second = await repository.capture(draft("orilla", "Caminamos por la orilla."));
    const preview = await repository.previewMerge(first.lexicalUnit.id, second.lexicalUnit.id);

    expect(preview.blocked).toBe(false);
    expect(preview.survivingLexicalUnitId).toBe(first.lexicalUnit.id);

    const result = await repository.mergeLexicalUnits({
      sourceId: first.lexicalUnit.id,
      targetId: second.lexicalUnit.id,
      expectedSnapshotToken: preview.snapshotToken,
      canonicalText: "banco",
      note: "",
    });

    expect(result.survivingLexicalUnitId).toBe(first.lexicalUnit.id);
    expect(result.item.lexicalUnit.status).toBe("inbox");
    expect(result.item.occurrences).toHaveLength(2);
    expect(await database.lexicalUnits.get(second.lexicalUnit.id)).toBeUndefined();
  });

  it("allows merge only when two exported bindings prove the same effective identity", async () => {
    const first = await repository.capture(draft("banco", "El banco está abierto."));
    const second = await repository.capture(draft("orilla", "Caminamos por la orilla."));
    const common = {
      profileId: "profile-a",
      state: "exported" as const,
      ankiNoteId: 5050,
      deckName: "Spanish RU",
      deckId: "2",
      modelName: "Collector Basic",
      modelId: "10",
    };
    await repository.setExportBinding({ lexicalUnitId: first.lexicalUnit.id, ...common });
    await repository.setExportBinding({ lexicalUnitId: second.lexicalUnit.id, ...common });

    const preview = await repository.previewMerge(first.lexicalUnit.id, second.lexicalUnit.id);
    expect(preview.blocked).toBe(false);
    expect(preview.survivingLexicalUnitId).toBe(first.lexicalUnit.id);

    const result = await repository.mergeLexicalUnits({
      sourceId: first.lexicalUnit.id,
      targetId: second.lexicalUnit.id,
      expectedSnapshotToken: preview.snapshotToken,
      canonicalText: "banco",
      note: "",
    });
    expect(await repository.getExportBinding(result.survivingLexicalUnitId)).toMatchObject(common);
    expect(await repository.listExportBindings()).toHaveLength(1);
  });

  it("rejects stale merge confirmation and leaves repository state unchanged", async () => {
    const first = await repository.capture(draft("banco", "El banco está abierto."));
    const second = await repository.capture(draft("orilla", "Caminamos por la orilla."));
    const preview = await repository.previewMerge(first.lexicalUnit.id, second.lexicalUnit.id);
    await repository.setStatus(second.lexicalUnit.id, "archived");

    await expect(repository.mergeLexicalUnits({
      sourceId: first.lexicalUnit.id,
      targetId: second.lexicalUnit.id,
      expectedSnapshotToken: preview.snapshotToken,
      canonicalText: "banco",
      note: "",
    })).rejects.toThrow("preview is stale");

    expect(await repository.list()).toHaveLength(2);
  });

  it("rolls back merge atomically when a required persistence step fails", async () => {
    const first = await repository.capture(draft("banco", "El banco está abierto."));
    const second = await repository.capture(draft("orilla", "Caminamos por la orilla."));
    const preview = await repository.previewMerge(first.lexicalUnit.id, second.lexicalUnit.id);
    const occurrenceIds = (await repository.list())
      .flatMap((item) => item.occurrences.map((occurrence) => occurrence.id))
      .sort();

    const deleteSpy = vi.spyOn(database.lexicalUnits, "delete")
      .mockRejectedValueOnce(new Error("Injected merge failure."));

    await expect(repository.mergeLexicalUnits({
      sourceId: first.lexicalUnit.id,
      targetId: second.lexicalUnit.id,
      expectedSnapshotToken: preview.snapshotToken,
      canonicalText: "banco",
      note: "",
    })).rejects.toThrow("Injected merge failure.");
    deleteSpy.mockRestore();

    const items = await repository.list();
    expect(items).toHaveLength(2);
    expect(items.flatMap((item) => item.occurrences.map((occurrence) => occurrence.id)).sort())
      .toEqual(occurrenceIds);
  });

  it("splits a subset into a new same-canonical identity without copying Anki identity", async () => {
    const first = await repository.capture(draft("banco", "El banco aprobó el préstamo."));
    const withSecond = await repository.capture(draft("banco", "Nos sentamos junto al banco del río."));
    await repository.setExportBinding({
      lexicalUnitId: first.lexicalUnit.id,
      profileId: "profile-a",
      state: "exported",
      ankiNoteId: 8080,
      deckName: "Spanish RU",
      modelName: "Collector Basic",
    });
    await repository.setStatus(first.lexicalUnit.id, "ready");

    const movedId = withSecond.occurrences[1]!.id;
    const originalId = first.lexicalUnit.id;
    const preview = await repository.previewSplit(originalId, [movedId]);
    const result = await repository.splitLexicalUnit({
      sourceId: originalId,
      selectedOccurrenceIds: [movedId],
      expectedSnapshotToken: preview.snapshotToken,
      canonicalText: "banco",
      note: "river-bank sense",
    });

    expect(result.source.lexicalUnit.id).toBe(originalId);
    expect(result.created.lexicalUnit.id).not.toBe(originalId);
    expect(result.source.lexicalUnit.canonicalText).toBe("banco");
    expect(result.created.lexicalUnit.canonicalText).toBe("banco");
    expect(result.source.lexicalUnit.status).toBe("inbox");
    expect(result.created.lexicalUnit.status).toBe("inbox");
    expect(result.source.occurrences).toHaveLength(1);
    expect(result.created.occurrences.map((occurrence) => occurrence.id)).toEqual([movedId]);
    expect(await repository.getExportBinding(originalId)).toMatchObject({
      state: "exported",
      ankiNoteId: 8080,
    });
    expect(await repository.getExportBinding(result.created.lexicalUnit.id)).toBeNull();
    expect(result.created.lexicalUnit.ankiNoteId).toBeUndefined();
  });

  it("rejects zero-selection, all-occurrence, and stale split ownership", async () => {
    const source = await repository.capture(draft("banco", "El banco aprobó el préstamo."));
    const withSecond = await repository.capture(draft("banco", "Nos sentamos junto al banco del río."));

    await expect(repository.previewSplit(source.lexicalUnit.id, []))
      .rejects.toThrow("Select at least one occurrence");
    await expect(repository.previewSplit(
      source.lexicalUnit.id,
      withSecond.occurrences.map((occurrence) => occurrence.id),
    )).rejects.toThrow("leave at least one occurrence");
    await expect(repository.previewSplit(source.lexicalUnit.id, ["missing-occurrence"]))
      .rejects.toThrow("no longer belongs");
  });

  it("rolls back split atomically on an injected occurrence move failure", async () => {
    const source = await repository.capture(draft("banco", "El banco aprobó el préstamo."));
    const withSecond = await repository.capture(draft("banco", "Nos sentamos junto al banco del río."));
    const movedId = withSecond.occurrences[1]!.id;
    const preview = await repository.previewSplit(source.lexicalUnit.id, [movedId]);

    const bulkPutSpy = vi.spyOn(database.occurrences, "bulkPut")
      .mockRejectedValueOnce(new Error("Injected split failure."));

    await expect(repository.splitLexicalUnit({
      sourceId: source.lexicalUnit.id,
      selectedOccurrenceIds: [movedId],
      expectedSnapshotToken: preview.snapshotToken,
      canonicalText: "banco",
      note: "",
    })).rejects.toThrow("Injected split failure.");
    bulkPutSpy.mockRestore();

    const items = await repository.list();
    expect(items).toHaveLength(1);
    expect(items[0]?.lexicalUnit.id).toBe(source.lexicalUnit.id);
    expect(items[0]?.occurrences.map((occurrence) => occurrence.id).sort()).toEqual(
      withSecond.occurrences.map((occurrence) => occurrence.id).sort(),
    );
  });

  it("treats same-canonical owners as ambiguous while exact existing evidence remains uniquely owned", async () => {
    const source = await repository.capture(draft("banco", "El banco aprobó el préstamo."));
    const withSecond = await repository.capture(draft("banco", "Nos sentamos junto al banco del río."));
    const movedOccurrence = withSecond.occurrences[1]!;
    const splitPreview = await repository.previewSplit(source.lexicalUnit.id, [movedOccurrence.id]);
    const split = await repository.splitLexicalUnit({
      sourceId: source.lexicalUnit.id,
      selectedOccurrenceIds: [movedOccurrence.id],
      expectedSnapshotToken: splitPreview.snapshotToken,
      canonicalText: "banco",
      note: "river sense",
    });

    await expect(repository.capture(draft("banco", "Un banco puede tener varios sentidos.")))
      .rejects.toThrow("ambiguous between multiple lexical units");

    const exact = await repository.capture(draft("banco", movedOccurrence.context));
    expect(exact.lexicalUnit.id).toBe(split.created.lexicalUnit.id);
    expect(exact.occurrences).toHaveLength(1);
  });

  it("restores two same-canonical lexical ids without consolidation", async () => {
    const backup: BackupDocument = {
      version: 4,
      exportedAt: "2026-09-26T00:00:00.000Z",
      settings: DEFAULT_SETTINGS,
      exportBindings: [],
      items: ["unit-a", "unit-b"].map((id, index) => ({
        lexicalUnit: {
          id,
          contentKey: "es::banco",
          canonicalText: "banco",
          normalizedCanonicalText: "banco",
          language: "es",
          note: index === 0 ? "financial" : "river",
          status: "inbox" as const,
          createdAt: `2026-09-25T00:0${index}:00.000Z`,
          updatedAt: `2026-09-25T00:0${index}:00.000Z`,
        },
        occurrences: [{
          id: `occ-${id}`,
          lexicalUnitId: id,
          surfaceText: "banco",
          normalizedSurfaceText: "banco",
          context: index === 0 ? "El banco aprobó el préstamo." : "El banco está junto al río.",
          source: {
            kind: "web" as const,
            adapter: "generic-web",
            url: "https://example.com",
            title: "Example",
          },
          capturedAt: `2026-09-25T00:0${index}:00.000Z`,
        }],
      })),
    };

    const preview = await repository.previewRestore(backup);
    expect(preview.conflicts).toEqual([]);
    expect(preview.lexicalUnitsAdded).toBe(2);
    await repository.restoreBackup(backup);

    const items = await repository.list();
    expect(items).toHaveLength(2);
    expect(new Set(items.map((item) => item.lexicalUnit.contentKey))).toEqual(new Set(["es::banco"]));
    expect(new Set(items.map((item) => item.lexicalUnit.id))).toEqual(new Set(["unit-a", "unit-b"]));
  });


  it("preserves an exported source identity when merging an unexported target", async () => {
    const exported = await repository.capture(draft("tengo", "Tengo tiempo."));
    const unexported = await repository.capture(draft("tener", "Quiero tener tiempo."));
    await repository.setExportBinding({
      lexicalUnitId: exported.lexicalUnit.id,
      profileId: "profile-a",
      state: "exported",
      ankiNoteId: 9090,
      deckName: "Spanish RU",
      deckId: "2",
      modelName: "Collector Basic",
      modelId: "10",
    });

    const preview = await repository.previewMerge(exported.lexicalUnit.id, unexported.lexicalUnit.id);
    expect(preview.survivingLexicalUnitId).toBe(exported.lexicalUnit.id);

    const result = await repository.mergeLexicalUnits({
      sourceId: exported.lexicalUnit.id,
      targetId: unexported.lexicalUnit.id,
      expectedSnapshotToken: preview.snapshotToken,
      canonicalText: "tener",
      note: "",
    });

    expect(result.survivingLexicalUnitId).toBe(exported.lexicalUnit.id);
    expect(result.item.lexicalUnit.id).toBe(exported.lexicalUnit.id);
    expect(await repository.getExportBinding(exported.lexicalUnit.id)).toMatchObject({
      state: "exported",
      ankiNoteId: 9090,
      deckId: "2",
      modelId: "10",
    });
    expect(await repository.getExportBinding(unexported.lexicalUnit.id)).toBeNull();
  });

  it("reselects valid best evidence on both sides when the previously selected occurrence is split", async () => {
    const first = await repository.capture(
      draft("banco", "banco"),
    );
    const withSecond = await repository.capture(
      draft(
        "banco",
        "Ayer fuimos al banco del centro para hablar con una asesora sobre el préstamo.",
      ),
    );

    const sourcePreview = await repository.previewSplit(
      first.lexicalUnit.id,
      [withSecond.occurrences[1]!.id],
    );
    expect(sourcePreview.source.selectedOccurrenceId).toBe(withSecond.occurrences[1]!.id);

    const result = await repository.splitLexicalUnit({
      sourceId: first.lexicalUnit.id,
      selectedOccurrenceIds: [withSecond.occurrences[1]!.id],
      expectedSnapshotToken: sourcePreview.snapshotToken,
      canonicalText: "banco",
      note: "separate sense",
    });

    const remainingPreview = await repository.previewMerge(
      result.source.lexicalUnit.id,
      result.created.lexicalUnit.id,
    );
    expect(remainingPreview.source.selectedOccurrenceId).toBe(result.source.occurrences[0]!.id);
    expect(remainingPreview.target.selectedOccurrenceId).toBe(result.created.occurrences[0]!.id);
  });

});
