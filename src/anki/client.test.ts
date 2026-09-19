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

  it("recovers when notesInfo returns the real deleted-note shape", async () => {
    const actions: string[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      actions.push(request.action);

      const resultByAction: Record<string, unknown> = {
        notesInfo: [{}],
        findNotes: [],
        addNote: 9001,
      };
      return new Response(JSON.stringify({
        result: resultByAction[request.action] ?? null,
        error: null,
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const noteId = await new AnkiClient("http://127.0.0.1:8765", fetcher).upsert(item(), settings());

    expect(noteId).toBe(9001);
    expect(actions).toEqual(["notesInfo", "findNotes", "addNote"]);
  });

  it("recovers when the stored Anki note was deleted", async () => {
    const actions: string[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      actions.push(request.action);

      if (request.action === "notesInfo") {
        return new Response(JSON.stringify({
          result: null,
          error: "Note was not found: 4242",
        }), { status: 200 });
      }

      const resultByAction: Record<string, unknown> = {
        findNotes: [],
        addNote: 9001,
      };
      return new Response(JSON.stringify({
        result: resultByAction[request.action] ?? null,
        error: null,
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const noteId = await new AnkiClient("http://127.0.0.1:8765", fetcher).upsert(item(), settings());

    expect(noteId).toBe(9001);
    expect(actions).toEqual(["notesInfo", "findNotes", "addNote"]);
  });

  it("does not swallow unrelated notesInfo errors", async () => {
    const actions: string[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      actions.push(request.action);

      return new Response(JSON.stringify({
        result: null,
        error: "Collection is not available",
      }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      new AnkiClient("http://127.0.0.1:8765", fetcher).upsert(item(), settings()),
    ).rejects.toThrow("Collection is not available");
    expect(actions).toEqual(["notesInfo"]);
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
  it("uses only read-only AnkiConnect actions for catalog discovery", async () => {
    const requests: Array<{ action: string; params: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      requests.push(request);

      const resultByAction: Record<string, unknown> = {
        version: 6,
        deckNamesAndIds: { "Hebrew RU": 111 },
        modelNamesAndIds: { "Hebrew Vocabulary": 222 },
        modelFieldNames: ["Hebrew", "Russian"],
        modelFieldsOnTemplates: {
          Recognition: [["Hebrew"], ["Hebrew", "Russian"]],
        },
        modelTemplates: {
          Recognition: {
            Front: "{{Hebrew}}",
            Back: "{{FrontSide}}<hr>{{Russian}}",
          },
        },
        modelStyling: {
          css: ".card { font-size: 22px; }",
        },
      };

      return new Response(JSON.stringify({
        result: resultByAction[request.action] ?? null,
        error: null,
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new AnkiClient("http://127.0.0.1:8765", fetcher);
    await client.ping();
    await client.deckNamesAndIds();
    await client.modelNamesAndIds();
    await client.modelFieldNames("Hebrew Vocabulary");
    await client.modelFieldsOnTemplates("Hebrew Vocabulary");
    await client.modelTemplates("Hebrew Vocabulary");
    await client.modelStyling("Hebrew Vocabulary");

    expect(requests.map(({ action }) => action)).toEqual([
      "version",
      "deckNamesAndIds",
      "modelNamesAndIds",
      "modelFieldNames",
      "modelFieldsOnTemplates",
      "modelTemplates",
      "modelStyling",
    ]);
    expect(requests.slice(3).map(({ params }) => params)).toEqual([
      { modelName: "Hebrew Vocabulary" },
      { modelName: "Hebrew Vocabulary" },
      { modelName: "Hebrew Vocabulary" },
      { modelName: "Hebrew Vocabulary" },
    ]);
    expect(requests.some(({ action }) => [
      "createDeck",
      "createModel",
      "modelFieldAdd",
      "updateModelTemplates",
      "updateModelStyling",
      "addNote",
      "updateNoteFields",
    ].includes(action))).toBe(false);
  });

  it("exports fields from the same best occurrence used by the proposal", async () => {
    const value = item();
    value.occurrences.push({
      ...value.occurrences[0]!,
      id: "occ-newer-weak",
      context: "tengo ganas de",
      capturedAt: "2026-09-19T11:00:00Z",
      source: {
        ...value.occurrences[0]!.source,
        url: "https://example.com/weak",
      },
    });

    const requests: Array<{ action: string; params: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      requests.push(request);
      const result = request.action === "notesInfo"
        ? [{ noteId: 4242 }]
        : null;
      return new Response(JSON.stringify({ result, error: null }), { status: 200 });
    }) as unknown as typeof fetch;

    await new AnkiClient("http://127.0.0.1:8765", fetcher).upsert(value, settings());

    const update = requests.find(({ action }) => action === "updateNoteFields");
    expect(update?.params).toMatchObject({
      note: {
        id: 4242,
        fields: {
          Prompt: "Hoy […] salir a caminar por el centro.",
          Observed: "tengo ganas de",
          Context: "Hoy tengo ganas de salir a caminar por el centro.",
          Source: "https://example.com",
        },
      },
    });
  });

});
