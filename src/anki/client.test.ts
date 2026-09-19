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
      contentKey: "es::tener ganas de",
      canonicalText: "tener ganas de",
      normalizedCanonicalText: "tener ganas de",
      language: "es",
      note: "Want / feel like doing something.",
      status: "ready",
      createdAt: "2026-09-18T10:00:00Z",
      updatedAt: "2026-09-19T10:00:00Z",
      ankiNoteId: 4242,
    },
    occurrences: [{
      id: "occ-1",
      lexicalUnitId: "unit-1",
      surfaceText: "tengo ganas de",
      normalizedSurfaceText: "tengo ganas de",
      context: "Hoy tengo ganas de salir a caminar por el centro.",
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
  it("invokes the default browser fetch with the global receiver", async () => {
    const nativeLikeFetch = vi.fn(function (this: unknown, _input: RequestInfo | URL, _init?: RequestInit) {
      expect(this).toBe(globalThis);
      return Promise.resolve(new Response(JSON.stringify({ result: 6, error: null }), { status: 200 }));
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", nativeLikeFetch);
    try {
      await expect(new AnkiClient().ping()).resolves.toBe(6);
      expect(nativeLikeFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("updates the existing note with canonical and observed forms", async () => {
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
    expect(actions[1]?.params).toEqual({
      note: {
        id: 4242,
        fields: {
          CollectorID: "unit-1",
          Prompt: "Hoy […] salir a caminar por el centro.",
          Answer: "tengo ganas de\n\nCanonical: tener ganas de\n\nWant / feel like doing something.",
          CardKind: "context-production",
          Why: "A multi-word canonical unit with an observed form in usable context is better practiced as one contextual production target.",
          Canonical: "tener ganas de",
          Observed: "tengo ganas de",
          Expression: "tener ganas de",
          Context: "Hoy tengo ganas de salir a caminar por el centro.",
          Note: "Want / feel like doing something.",
          Source: "https://example.com",
        },
      },
    });
  });

  it("adds canonical/observed fields and migrates only the unchanged legacy template", async () => {
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

    expect(actions.filter((action) => action === "modelFieldAdd")).toHaveLength(6);
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
        modelFieldNames: ["CollectorID", "Prompt", "Answer", "CardKind", "Why", "Canonical", "Observed", "Expression", "Context", "Note", "Source"],
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
});
