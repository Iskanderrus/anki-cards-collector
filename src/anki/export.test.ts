import { describe, expect, it } from "vitest";
import { toTsv } from "./export";
import type { CollectedItem } from "../core/types";

describe("toTsv", () => {
  it("keeps one row per lexical unit and flattens multiline context", () => {
    const item: CollectedItem = {
      lexicalUnit: {
        id: "unit-1",
        contentKey: "es::aunque",
        displayText: "aunque",
        normalizedText: "aunque",
        language: "es",
        note: "",
        status: "ready",
        createdAt: "2026-09-18T10:00:00Z",
        updatedAt: "2026-09-18T10:00:00Z",
      },
      occurrences: [{
        id: "occ-1",
        lexicalUnitId: "unit-1",
        context: "Aunque llueva,\nvoy.",
        capturedAt: "2026-09-18T10:00:00Z",
        source: {
          kind: "web",
          adapter: "generic-web",
          url: "https://example.com",
          title: "Example",
        },
      }],
    };

    expect(toTsv([item])).toContain("aunque\tAunque llueva, voy.\thttps://example.com");
  });
});
