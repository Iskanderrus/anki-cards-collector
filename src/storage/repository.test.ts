import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CollectorDatabase } from "./database";
import { CaptureRepository } from "./repository";
import type { CaptureDraft } from "../core/types";

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
});
