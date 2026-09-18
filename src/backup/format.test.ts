import { describe, expect, it } from "vitest";
import type { CollectedItem } from "../core/types";
import { parseBackup, serializeBackup } from "./format";

function sampleItem(): CollectedItem {
  return {
    lexicalUnit: {
      id: "unit-1",
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
      id: "occ-1",
      lexicalUnitId: "unit-1",
      context: "Aunque llueva, voy.",
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

    expect(backup.version).toBe(1);
    expect(backup.exportedAt).toBe("2026-09-19T10:00:00Z");
    expect(backup.items).toEqual([sampleItem()]);
  });

  it("rejects backups produced by a newer schema", () => {
    expect(() => parseBackup(JSON.stringify({
      version: 2,
      exportedAt: "2026-09-19T10:00:00Z",
      items: [],
    }))).toThrow("Backup version 2 is newer than this extension supports");
  });

  it("rejects content keys that do not match expression and language", () => {
    const item = sampleItem();
    item.lexicalUnit.contentKey = "es::porque";

    expect(() => parseBackup(serializeBackup([item]))).toThrow(
      "contentKey does not match expression and language",
    );
  });

  it("rejects occurrences attached to a different lexical unit", () => {
    const item = sampleItem();
    item.occurrences[0]!.lexicalUnitId = "other-unit";

    expect(() => parseBackup(serializeBackup([item]))).toThrow(
      "lexicalUnitId does not match its lexical unit",
    );
  });
});
