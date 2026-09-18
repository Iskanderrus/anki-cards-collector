import { describe, expect, it, vi } from "vitest";
import type { CollectedItem, CollectorSettings } from "../core/types";
import { exportBatch, type AnkiExportClient, type ExportProgress } from "./batch";

function item(id: string, text: string): CollectedItem {
  return {
    lexicalUnit: {
      id,
      contentKey: `es::${text.toLowerCase()}`,
      displayText: text,
      normalizedText: text.toLowerCase(),
      language: "es",
      note: "",
      status: "ready",
      createdAt: "2026-09-19T00:00:00Z",
      updatedAt: "2026-09-19T00:00:00Z",
    },
    occurrences: [],
  };
}

const settings: CollectorSettings = {
  defaultLanguage: "es",
  deckName: "Collector",
  modelName: "Collector",
  sourceUrlMode: "sanitized",
};

describe("exportBatch", () => {
  it("continues after an item fails and persists successful note IDs", async () => {
    const upsert = vi.fn(async (current: CollectedItem) => {
      if (current.lexicalUnit.id === "two") throw new Error("Rejected note");
      return current.lexicalUnit.id === "one" ? 101 : 303;
    });

    const client: AnkiExportClient = {
      ping: vi.fn(async () => 6),
      ensureDeckAndModel: vi.fn(async () => undefined),
      upsert,
    };
    const persisted: Array<[string, number]> = [];
    const progress: ExportProgress[] = [];

    const report = await exportBatch(
      [item("one", "uno"), item("two", "dos"), item("three", "tres")],
      settings,
      client,
      async (id, noteId) => {
        persisted.push([id, noteId]);
      },
      (value) => progress.push(value),
    );

    expect(upsert).toHaveBeenCalledTimes(3);
    expect(persisted).toEqual([["one", 101], ["three", 303]]);
    expect(report).toMatchObject({
      total: 3,
      exported: 2,
      failed: 1,
      warnings: 0,
    });
    expect(report.results.map((result) => result.kind)).toEqual([
      "exported",
      "failed",
      "exported",
    ]);
    expect(progress.at(-1)?.completed).toBe(3);
    expect(progress.at(-1)?.total).toBe(3);
  });

  it("reports a local persistence warning without calling the Anki export a failure", async () => {
    const client: AnkiExportClient = {
      ping: vi.fn(async () => 6),
      ensureDeckAndModel: vi.fn(async () => undefined),
      upsert: vi.fn(async () => 4242),
    };

    const report = await exportBatch(
      [item("one", "uno")],
      settings,
      client,
      async () => {
        throw new Error("IndexedDB unavailable");
      },
    );

    expect(report).toMatchObject({
      total: 1,
      exported: 1,
      failed: 0,
      warnings: 1,
    });
    expect(report.results[0]).toMatchObject({
      kind: "exported_untracked",
      noteId: 4242,
    });
  });

  it("stops before item processing when Anki setup fails", async () => {
    const upsert = vi.fn(async () => 1);
    const client: AnkiExportClient = {
      ping: vi.fn(async () => {
        throw new Error("Anki is offline");
      }),
      ensureDeckAndModel: vi.fn(async () => undefined),
      upsert,
    };

    await expect(exportBatch(
      [item("one", "uno")],
      settings,
      client,
      async () => undefined,
    )).rejects.toThrow("Anki is offline");

    expect(upsert).not.toHaveBeenCalled();
  });
});
