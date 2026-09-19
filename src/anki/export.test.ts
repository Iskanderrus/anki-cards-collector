import { describe, expect, it } from "vitest";
import { toTsv } from "./export";
import type { CollectedItem } from "../core/types";

describe("toTsv", () => {
  it("exports canonical and observed forms with the reviewed proposal", () => {
    const item: CollectedItem = {
      lexicalUnit: {
        id: "unit-1",
        contentKey: "es::tener ganas de",
        canonicalText: "tener ganas de",
        normalizedCanonicalText: "tener ganas de",
        language: "es",
        note: "Want / feel like doing something.",
        status: "ready",
        createdAt: "2026-09-18T10:00:00Z",
        updatedAt: "2026-09-18T10:00:00Z",
      },
      occurrences: [{
        id: "occ-1",
        lexicalUnitId: "unit-1",
        surfaceText: "tengo ganas de",
        normalizedSurfaceText: "tengo ganas de",
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

    expect(header).toBe("CollectorID\tCardKind\tPrompt\tAnswer\tWhy\tCanonical\tObserved\tContext\tNote\tSource");
    expect(row).toContain("unit-1\tcontext-production\tHoy […] salir a caminar por el centro.");
    expect(row).toContain("\ttener ganas de\ttengo ganas de\tHoy tengo ganas de salir a caminar por el centro.");
    expect(row).toContain("\thttps://example.com");
  });
  it("exports the same best occurrence used by the reviewed proposal", () => {
    const item: CollectedItem = {
      lexicalUnit: {
        id: "unit-2",
        contentKey: "es::tener ganas de",
        canonicalText: "tener ganas de",
        normalizedCanonicalText: "tener ganas de",
        language: "es",
        note: "",
        status: "ready",
        createdAt: "2026-09-19T10:00:00Z",
        updatedAt: "2026-09-19T11:00:00Z",
      },
      occurrences: [
        {
          id: "older-strong",
          lexicalUnitId: "unit-2",
          surfaceText: "tengo ganas de",
          normalizedSurfaceText: "tengo ganas de",
          context: "Hoy tengo ganas de salir a caminar por el centro.",
          capturedAt: "2026-09-19T10:00:00Z",
          source: {
            kind: "web",
            adapter: "generic-web",
            url: "https://example.com/strong",
            title: "Strong",
          },
        },
        {
          id: "newer-weak",
          lexicalUnitId: "unit-2",
          surfaceText: "tengo ganas de",
          normalizedSurfaceText: "tengo ganas de",
          context: "tengo ganas de",
          capturedAt: "2026-09-19T11:00:00Z",
          source: {
            kind: "web",
            adapter: "generic-web",
            url: "https://example.com/weak",
            title: "Weak",
          },
        },
      ],
    };

    const result = toTsv([item]);
    const row = result.split("\n")[1]!;

    expect(row).toContain("Hoy […] salir a caminar por el centro.");
    expect(row).toContain("\ttengo ganas de\tHoy tengo ganas de salir a caminar por el centro.");
    expect(row).toContain("\thttps://example.com/strong");
    expect(row).not.toContain("https://example.com/weak");
  });

});
