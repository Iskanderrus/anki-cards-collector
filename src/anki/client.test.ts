import { describe, expect, it, vi } from "vitest";
import { AnkiClient } from "./client";
import type { CollectedItem, CollectorSettings } from "../core/types";

describe("AnkiClient", () => {
  it("updates the existing Collector note after local edits", async () => {
    const actions: Array<{ action: string; params: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      actions.push(request);

      const result = request.action === "notesInfo"
        ? [{ noteId: 4242 }]
        : null;

      return new Response(JSON.stringify({ result, error: null }), { status: 200 });
    }) as unknown as typeof fetch;

    const item: CollectedItem = {
      lexicalUnit: {
        id: "unit-1",
        contentKey: "es::aun cuando",
        displayText: "aun cuando",
        normalizedText: "aun cuando",
        language: "es",
        note: "Formal contrast.",
        status: "ready",
        createdAt: "2026-09-18T10:00:00Z",
        updatedAt: "2026-09-19T10:00:00Z",
        ankiNoteId: 4242,
      },
      occurrences: [{
        id: "occ-1",
        lexicalUnitId: "unit-1",
        context: "Aun cuando llueva, voy.",
        capturedAt: "2026-09-18T10:00:00Z",
        source: {
          kind: "web",
          adapter: "generic-web",
          url: "https://example.com",
          title: "Example",
        },
      }],
    };
    const settings: CollectorSettings = {
      defaultLanguage: "es",
      deckName: "Collector",
      modelName: "Collector",
      sourceUrlMode: "sanitized",
    };

    const noteId = await new AnkiClient("http://127.0.0.1:8765", fetcher).upsert(item, settings);

    expect(noteId).toBe(4242);
    expect(actions.map(({ action }) => action)).toEqual(["notesInfo", "updateNoteFields"]);
    expect(actions.some(({ action }) => action === "addNote")).toBe(false);
    expect(actions[1]?.params).toEqual({
      note: {
        id: 4242,
        fields: {
          CollectorID: "unit-1",
          Expression: "aun cuando",
          Context: "Aun cuando llueva, voy.",
          Note: "Formal contrast.",
          Source: "https://example.com",
        },
      },
    });
  });
});
