import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BackupDocumentV1 } from "../backup/format";
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

  it("deduplicates lexical units but keeps each occurrence", async () => {
    await repository.capture(draft("tener ganas de", "Tengo ganas de salir."));
    await repository.capture(draft("  Tener  ganas de ", "No tengo ganas de cocinar."));

    const items = await repository.list();

    expect(items).toHaveLength(1);
    expect(items[0]?.occurrences).toHaveLength(2);
    expect(items[0]?.lexicalUnit.displayText).toBe("tener ganas de");
  });

  it("supports an explicit review state", async () => {
    const captured = await repository.capture(draft("aunque", "Aunque llueva, voy."));
    await repository.setStatus(captured.lexicalUnit.id, "ready");

    expect(await repository.list("ready")).toHaveLength(1);
    expect(await repository.list("inbox")).toHaveLength(0);
  });

  it("edits study content without changing Collector or Anki identity", async () => {
    const captured = await repository.capture(draft("aunque", "Aunque llueva, voy."));
    await repository.setAnkiNoteId(captured.lexicalUnit.id, 4242);
    const occurrenceId = captured.occurrences[0]?.id;
    expect(occurrenceId).toBeDefined();

    const updated = await repository.update(captured.lexicalUnit.id, {
      displayText: "  aun   cuando ",
      language: "ES",
      note: "More formal in this example.",
      occurrenceId,
      context: "Aun cuando llueva, voy.",
    });

    expect(updated.lexicalUnit.id).toBe(captured.lexicalUnit.id);
    expect(updated.lexicalUnit.ankiNoteId).toBe(4242);
    expect(updated.lexicalUnit.displayText).toBe("aun cuando");
    expect(updated.lexicalUnit.contentKey).toBe("es::aun cuando");
    expect(updated.lexicalUnit.language).toBe("es");
    expect(updated.lexicalUnit.note).toBe("More formal in this example.");
    expect(updated.occurrences[0]?.context).toBe("Aun cuando llueva, voy.");
  });

  it("rejects an edit that would collide with another lexical unit", async () => {
    const first = await repository.capture(draft("aunque", "Aunque llueva, voy."));
    const second = await repository.capture(draft("porque", "Voy porque quiero."));

    await expect(repository.update(second.lexicalUnit.id, {
      displayText: " Aunque ",
      language: "es",
      note: "",
      occurrenceId: second.occurrences[0]?.id,
      context: "Voy aunque llueva.",
    })).rejects.toThrow("Another collected item already uses this expression and language.");

    const items = await repository.list();
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.lexicalUnit.id === first.lexicalUnit.id)?.lexicalUnit.displayText).toBe("aunque");
    expect(items.find((item) => item.lexicalUnit.id === second.lexicalUnit.id)?.lexicalUnit.displayText).toBe("porque");
  });

  it("restores a backup idempotently and skips duplicate occurrences", async () => {
    const backup: BackupDocumentV1 = {
      version: 1,
      exportedAt: "2026-09-19T10:00:00Z",
      items: [{
        lexicalUnit: {
          id: "unit-restore",
          contentKey: "es::aunque",
          displayText: "aunque",
          normalizedText: "aunque",
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
            context: "Aunque llueva, voy.",
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
            context: "Aunque llueva, voy.",
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
    const afterFirstRestore = await repository.list();
    expect(afterFirstRestore).toHaveLength(1);
    expect(afterFirstRestore[0]?.occurrences).toHaveLength(1);

    expect(await repository.previewRestore(backup)).toMatchObject({
      lexicalUnitsSkipped: 1,
      occurrencesAdded: 0,
      occurrencesSkipped: 2,
      conflicts: [],
    });
  });

  it("uses a newer backup to update the same lexical unit and occurrence", async () => {
    const captured = await repository.capture(draft("aunque", "Aunque llueva, voy."));
    const occurrence = captured.occurrences[0]!;

    const backup: BackupDocumentV1 = {
      version: 1,
      exportedAt: "2099-01-02T00:00:00Z",
      items: [{
        lexicalUnit: {
          ...captured.lexicalUnit,
          note: "Restored newer note.",
          updatedAt: "2099-01-01T00:00:00Z",
        },
        occurrences: [{
          ...occurrence,
          context: "Aunque haga frío, voy.",
        }],
      }],
    };

    expect(await repository.previewRestore(backup)).toMatchObject({
      lexicalUnitsUpdated: 1,
      occurrencesUpdated: 1,
      conflicts: [],
    });

    await repository.restoreBackup(backup);
    const restored = (await repository.list())[0]!;
    expect(restored.lexicalUnit.id).toBe(captured.lexicalUnit.id);
    expect(restored.lexicalUnit.note).toBe("Restored newer note.");
    expect(restored.occurrences[0]?.id).toBe(occurrence.id);
    expect(restored.occurrences[0]?.context).toBe("Aunque haga frío, voy.");
  });

  it("blocks restore when another Collector ID already owns the content key", async () => {
    await repository.capture(draft("aunque", "Aunque llueva, voy."));

    const backup: BackupDocumentV1 = {
      version: 1,
      exportedAt: "2026-09-19T10:00:00Z",
      items: [{
        lexicalUnit: {
          id: "different-id",
          contentKey: "es::aunque",
          displayText: "aunque",
          normalizedText: "aunque",
          language: "es",
          note: "",
          status: "ready",
          createdAt: "2026-09-19T09:00:00Z",
          updatedAt: "2026-09-19T09:00:00Z",
        },
        occurrences: [],
      }],
    };

    const preview = await repository.previewRestore(backup);
    expect(preview.conflicts).toHaveLength(1);
    await expect(repository.restoreBackup(backup)).rejects.toThrow("Backup has 1 conflict");

    const items = await repository.list();
    expect(items).toHaveLength(1);
    expect(items[0]?.lexicalUnit.id).not.toBe("different-id");
  });
});
