import { describe, expect, it } from "vitest";
import { toTsv } from "./export";
import type { CollectedItem } from "../core/types";

describe("toTsv", () => {
  it("exports the same derived card proposal shown to the reviewer", () => {
    const item: CollectedItem = {
      lexicalUnit: {
        id: "unit-1",
        contentKey: "es::tener ganas de",
        displayText: "tener ganas de",
        normalizedText: "tener ganas de",
        language: "es",
        note: "Want / feel like doing something.",
        status: "ready",
        createdAt: "2026-09-18T10:00:00Z",
        updatedAt: "2026-09-18T10:00:00Z",
      },
      occurrences: [{
        id: "occ-1",
        lexicalUnitId: "unit-1",
        context: "Hoy tengo ganas de\nsalir a caminar por el centro.",
        capturedAt: "2026-09-18T10:00:00Z",
        source: {
          kind: "web",
          adapter: "generic-web",
          url: "https://example.com",
          title: "Example",
        },
      }],
    };

    const result = toTsv([item]);
    const [header, row] = result.split("\n");

    expect(header).toBe("CollectorID\tCardKind\tPrompt\tAnswer\tWhy\tExpression\tContext\tNote\tSource");
    expect(row).toContain("unit-1\tcontext-production\tHoy […] salir a caminar por el centro.");
    expect(row).toContain("\ttener ganas de Want / feel like doing something.\t");
    expect(row).toContain("\ttener ganas de\tHoy tengo ganas de salir a caminar por el centro.");
    expect(row).toContain("\thttps://example.com");
  });
});
