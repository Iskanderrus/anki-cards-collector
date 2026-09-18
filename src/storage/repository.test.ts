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
});
