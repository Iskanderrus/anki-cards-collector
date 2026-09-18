import { describe, expect, it } from "vitest";
import type { CollectedItem } from "../core/types";
import { parseBackup, serializeBackup } from "./format";

function sampleItem(): CollectedItem {
  return {
    lexicalUnit: {
      id: "unit-1",
      contentKey: "es::tener",
      canonicalText: "tener",
      normalizedCanonicalText: "tener",
      language: "es",
      note: "",
      status: "ready",
      createdAt: "2026-09-18T10:00:00Z",
      updatedAt: "2026-09-18T11:00:00Z",
    },
    occurrences: [{
      id: "occ-1",
      lexicalUnitId: "unit-1",
      surfaceText: "tengo",
      normalizedSurfaceText: "tengo",
      context: "Tengo tiempo.",
      source: {
        kind: "web",
        adapter: "generic-web",
        url: "https://example.com",
        title: "Example",
      },
      capturedAt: "2026-09-18T10:00:00Z",
    }],
  };
}

describe("backup format", () => {
  it("round-trips the current backup schema", () => {
    const raw = serializeBackup([sampleItem()], "2026-09-19T10:00:00Z");
    const backup = parseBackup(raw);

    expect(backup.version).toBe(2);
    expect(backup.exportedAt).toBe("2026-09-19T10:00:00Z");
    expect(backup.items).toEqual([sampleItem()]);
  });

  it("migrates a v1 backup into canonical and observed forms", () => {
    const backup = parseBackup(JSON.stringify({
      version: 1,
      exportedAt: "2026-09-19T10:00:00Z",
      items: [{
        lexicalUnit: {
          id: "legacy-unit",
          contentKey: "es::aunque",
          displayText: "aunque",
          normalizedText: "aunque",
          language: "es",
          note: "",
          status: "ready",
          createdAt: "2026-09-18T10:00:00Z",
          updatedAt: "2026-09-18T11:00:00Z",
        },
        occurrences: [{
          id: "legacy-occ",
          lexicalUnitId: "legacy-unit",
          context: "Aunque llueva, voy.",
          source: {
            kind: "web",
            adapter: "generic-web",
            url: "https://example.com",
            title: "Example",
          },
          capturedAt: "2026-09-18T10:00:00Z",
        }],
      }],
    }));

    expect(backup.version).toBe(2);
    expect(backup.items[0]?.lexicalUnit.canonicalText).toBe("aunque");
    expect(backup.items[0]?.occurrences[0]?.surfaceText).toBe("aunque");
  });

  it("rejects backups produced by a newer schema", () => {
    expect(() => parseBackup(JSON.stringify({
      version: 3,
      exportedAt: "2026-09-19T10:00:00Z",
      items: [],
    }))).toThrow("Backup version 3 is newer than this extension supports");
  });

  it("rejects canonical content keys that do not match form and language", () => {
    const item = sampleItem();
    item.lexicalUnit.contentKey = "es::porque";

    expect(() => parseBackup(serializeBackup([item]))).toThrow(
      "contentKey does not match canonical form and language",
    );
  });

  it("rejects observed forms whose normalized value is inconsistent", () => {
    const item = sampleItem();
    item.occurrences[0]!.normalizedSurfaceText = "tener";

    expect(() => parseBackup(serializeBackup([item]))).toThrow(
      "normalizedSurfaceText does not match surfaceText",
    );
  });
});
