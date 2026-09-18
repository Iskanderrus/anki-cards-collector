import { describe, expect, it, vi } from "vitest";
import type { CollectedItem, CollectorSettings } from "../core/types";
import { exportReadyItems } from "./batch";

function item(id: string, displayText: string): CollectedItem {
  return {
    lexicalUnit: {
      id,
      contentKey: `es::${displayText.toLowerCase()}`,
      displayText,
      normalizedText: displayText,
      language: "es",
      note: "",
      status: "ready",
      createdAt: "2026-09-18T10:00:00Z",
      updatedAt: "2026-09-18T10:00:00Z",
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

describe("exportReadyItems", () => {
  it("continues after an item failure and persists successful note IDs", async () => {
    const items = [
      item("unit-1", "aunque"),
      item("unit-2", "porque"),
      item("unit-3", "todavía"),
    ];
    const upsert = vi.fn(async (current: CollectedItem) => {
      if (current.lexicalUnit.id === "unit-2") {
        throw new Error("Anki rejected this note.");
      }
      return current.lexicalUnit.id === "unit-1" ? 101 : 303;
    });
    const persistNoteId = vi.fn(async () => undefined);
    const progress = vi.fn();

    const result = await exportReadyItems(
      items,
      { upsert },
      settings,
      persistNoteId,
      progress,
    );

    expect(result).toEqual({
      succeeded: 2,
      failures: [{
        id: "unit-2",
        displayText: "porque",
        message: "Anki rejected this note.",
      }],
    });
    expect(upsert).toHaveBeenCalledTimes(3);
    expect(persistNoteId.mock.calls).toEqual([
      ["unit-1", 101],
      ["unit-3", 303],
    ]);
    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      { completed: 0, total: 3, currentDisplayText: "aunque" },
      { completed: 1, total: 3, currentDisplayText: "porque" },
      { completed: 2, total: 3, currentDisplayText: "todavía" },
    ]);
  });

  it("reports local note-id persistence failures so a safe retry can recover", async () => {
    const current = item("unit-1", "aunque");
    const persistNoteId = vi.fn(async () => {
      throw new Error("IndexedDB write failed.");
    });

    const result = await exportReadyItems(
      [current],
      { upsert: vi.fn(async () => 101) },
      settings,
      persistNoteId,
    );

    expect(result.succeeded).toBe(0);
    expect(result.failures).toEqual([{
      id: "unit-1",
      displayText: "aunque",
      message: "IndexedDB write failed.",
    }]);
  });
});
