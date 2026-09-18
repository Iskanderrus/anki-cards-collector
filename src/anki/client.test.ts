import { describe, expect, it, vi } from "vitest";
import { AnkiClient } from "./client";
import type { CollectedItem, CollectorSettings } from "../core/types";

function settings(): CollectorSettings {
  return {
    defaultLanguage: "es",
    deckName: "Collector",
    modelName: "Collector",
    sourceUrlMode: "sanitized",
  };
}

function item(): CollectedItem {
  return {
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
      context: "Aun cuando llueva, voy a caminar por el centro.",
      capturedAt: "2026-09-18T10:00:00Z",
      source: {
        kind: "web",
        adapter: "generic-web",
        url: "https://example.com",
        title: "Example",
      },
    }],
  };
}

describe("AnkiClient", () => {
  it("updates the existing Collector note with the reviewed learning proposal", async () => {
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

    const noteId = await new AnkiClient("http://127.0.0.1:8765", fetcher).upsert(item(), settings());

    expect(noteId).toBe(4242);
    expect(actions.map(({ action }) => action)).toEqual(["notesInfo", "updateNoteFields"]);
    expect(actions.some(({ action }) => action === "addNote")).toBe(false);
    expect(actions[1]?.params).toEqual({
      note: {
        id: 4242,
        fields: {
          CollectorID: "unit-1",
          Prompt: "[…] llueva, voy a caminar por el centro.",
          Answer: "aun cuando\n\nFormal contrast.",
          CardKind: "context-production",
          Why: "A multi-word expression with usable context is better practiced as one contextual production target.",
          Expression: "aun cuando",
          Context: "Aun cuando llueva, voy a caminar por el centro.",
          Note: "Formal contrast.",
          Source: "https://example.com",
        },
      },
    });
  });

  it("migrates only the unchanged legacy Collector template", async () => {
    const actions: string[] = [];
    const oldBack = "{{FrontSide}}<hr id=answer><div class=context>{{Context}}</div><div class=context>{{Note}}</div><div class=context>{{Source}}</div>";

    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      actions.push(request.action);

      const resultByAction: Record<string, unknown> = {
        deckNames: ["Collector"],
        modelNames: ["Collector"],
        modelFieldNames: ["CollectorID", "Expression", "Context", "Note", "Source"],
        modelTemplates: {
          Recognition: {
            Front: "{{Expression}}",
            Back: oldBack,
          },
        },
        modelFieldAdd: null,
        updateModelTemplates: null,
        updateModelStyling: null,
      };

      return new Response(JSON.stringify({
        result: resultByAction[request.action] ?? null,
        error: null,
      }), { status: 200 });
    }) as unknown as typeof fetch;

    await new AnkiClient("http://127.0.0.1:8765", fetcher).ensureDeckAndModel(settings());

    expect(actions.filter((action) => action === "modelFieldAdd")).toHaveLength(4);
    expect(actions).toContain("updateModelTemplates");
    expect(actions).toContain("updateModelStyling");
  });

  it("does not overwrite a custom existing template", async () => {
    const actions: string[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      actions.push(request.action);

      const resultByAction: Record<string, unknown> = {
        deckNames: ["Collector"],
        modelNames: ["Collector"],
        modelFieldNames: ["CollectorID", "Prompt", "Answer", "CardKind", "Why", "Expression", "Context", "Note", "Source"],
        modelTemplates: {
          Recognition: {
            Front: "<div>{{Expression}}</div>",
            Back: "{{FrontSide}}<hr>{{Note}}",
          },
        },
      };

      return new Response(JSON.stringify({
        result: resultByAction[request.action] ?? null,
        error: null,
      }), { status: 200 });
    }) as unknown as typeof fetch;

    await new AnkiClient("http://127.0.0.1:8765", fetcher).ensureDeckAndModel(settings());

    expect(actions).not.toContain("updateModelTemplates");
    expect(actions).not.toContain("updateModelStyling");
  });

  it("refuses export when the policy says the capture needs review", async () => {
    const broad = item();
    broad.lexicalUnit.displayText = "Esta frase es demasiado larga y no tiene suficiente contexto para convertirse en una sola tarjeta útil de recuperación porque contiene demasiadas palabras y objetivos a la vez sin un foco claro adicional";
    broad.lexicalUnit.note = "";
    broad.occurrences[0]!.context = broad.lexicalUnit.displayText;

    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(
      new AnkiClient("http://127.0.0.1:8765", fetcher).upsert(broad, settings()),
    ).rejects.toThrow("Shorten the capture");

    expect(fetcher).not.toHaveBeenCalled();
  });
});
