import { describe, expect, it, vi } from "vitest";
import { AnkiClient } from "./client";
import type { CollectedItem, ExportProfile } from "../core/types";

function profile(): ExportProfile {
  return {
    id: "collector",
    name: "Collector",
    deckName: "Collector",
    modelName: "Collector Basic",
    mode: "collector-managed",
  };
}

function mappedProfile(): ExportProfile {
  return {
    id: "mapped-he",
    name: "Hebrew existing",
    deckName: "Hebrew RU",
    modelName: "Hebrew Existing",
    mode: "mapped-user-model",
    fieldMapping: {
      Prompt: "Hebrew",
      Answer: "Russian",
      Canonical: "Lemma",
      Context: "Example",
    },
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

    const noteId = await new AnkiClient("http://127.0.0.1:8765", fetcher).upsert(item(), profile());

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

    const noteId = await new AnkiClient("http://127.0.0.1:8765", fetcher).upsert(item(), profile());

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
      new AnkiClient("http://127.0.0.1:8765", fetcher).upsert(item(), profile()),
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

    const noteId = await new AnkiClient("http://127.0.0.1:8765", fetcher).upsert(item(), profile());

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
        modelNames: ["Collector Basic"],
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

    await new AnkiClient("http://127.0.0.1:8765", fetcher).ensureDeckAndModel(profile());

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
        modelNames: ["Collector Basic"],
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

    await new AnkiClient("http://127.0.0.1:8765", fetcher).ensureDeckAndModel(profile());

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

    await new AnkiClient("http://127.0.0.1:8765", fetcher).upsert(value, profile());

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


  it("does not implicitly create a missing deck for an added export profile", async () => {
    const actions: string[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      actions.push(request.action);

      const result = request.action === "deckNames"
        ? ["Existing Deck"]
        : null;
      return new Response(JSON.stringify({ result, error: null }), { status: 200 });
    }) as unknown as typeof fetch;

    const addedProfile: ExportProfile = {
      id: "he-profile",
      name: "Hebrew",
      deckName: "Missing Hebrew Deck",
      modelName: "Collector Basic",
      mode: "collector-managed",
    };

    await expect(
      new AnkiClient("http://127.0.0.1:8765", fetcher).ensureDeckAndModel(addedProfile),
    ).rejects.toThrow("create this saved deck explicitly");

    expect(actions).toEqual(["deckNames"]);
    expect(actions).not.toContain("createDeck");
  });

  it("refuses a missing deck for the default profile instead of creating it implicitly", async () => {
    const actions: string[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      actions.push(request.action);

      const result = request.action === "deckNames" ? [] : null;
      return new Response(JSON.stringify({ result, error: null }), { status: 200 });
    }) as unknown as typeof fetch;

    const fallback: ExportProfile = {
      id: "collector-default",
      name: "Collector default",
      deckName: "Collector Inbox",
      modelName: "Collector Basic",
      mode: "collector-managed",
    };

    await expect(
      new AnkiClient("http://127.0.0.1:8765", fetcher).ensureDeckAndModel(fallback),
    ).rejects.toThrow("create this saved deck explicitly");

    expect(actions).toEqual(["deckNames"]);
    expect(actions).not.toContain("createDeck");
  });

  it("creates a deck only through the explicit createDeck action", async () => {
    const requests: Array<{ action: string; version: number; params: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        version: number;
        params: Record<string, unknown>;
      };
      requests.push(request);
      return new Response(JSON.stringify({ result: 123, error: null }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      new AnkiClient("http://127.0.0.1:8765", fetcher).createDeck("Collector Inbox"),
    ).resolves.toBe(123);

    expect(requests).toEqual([{
      action: "createDeck",
      version: 6,
      params: { deck: "Collector Inbox" },
    }]);
  });

  it("moves all cards of an existing note through an explicit changeDeck action", async () => {
    const requests: Array<{ action: string; params: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      requests.push(request);
      const result = request.action === "findCards" ? [71, 72] : null;
      return new Response(JSON.stringify({ result, error: null }), { status: 200 });
    }) as unknown as typeof fetch;

    await new AnkiClient("http://127.0.0.1:8765", fetcher).moveNoteToDeck(
      4242,
      "Hebrew RU",
    );

    expect(requests).toEqual([
      { action: "findCards", version: 6, params: { query: "nid:4242" } },
      { action: "changeDeck", version: 6, params: { cards: [71, 72], deck: "Hebrew RU" } },
    ]);
  });


  it("refuses schema mutation for an arbitrary model even when mode claims collector-managed", async () => {
    const actions: string[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { action: string };
      actions.push(request.action);
      return new Response(JSON.stringify({ result: null, error: null }), { status: 200 });
    }) as unknown as typeof fetch;

    const unsafe: ExportProfile = {
      id: "unsafe",
      name: "Unsafe",
      deckName: "Hebrew RU",
      modelName: "My Existing Hebrew Model",
      mode: "collector-managed",
    };

    await expect(
      new AnkiClient("http://127.0.0.1:8765", fetcher).ensureDeckAndModel(unsafe),
    ).rejects.toThrow("not the recognized Collector-managed model");

    expect(actions).toEqual([]);
  });


  it("validates a user-owned model through read-only Anki metadata without mutating its schema or templates", async () => {
    const actions: string[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      actions.push(request.action);

      const resultByAction: Record<string, unknown> = {
        deckNames: ["Hebrew RU"],
        modelNames: ["Hebrew Existing"],
        modelFieldNames: ["Hebrew", "Russian", "Lemma", "Example", "Private Notes"],
      };
      return new Response(JSON.stringify({
        result: resultByAction[request.action] ?? null,
        error: null,
      }), { status: 200 });
    }) as unknown as typeof fetch;

    await new AnkiClient("http://127.0.0.1:8765", fetcher)
      .ensureDeckAndModel(mappedProfile());

    expect(actions).toEqual(["deckNames", "modelNames", "modelFieldNames"]);
    expect(actions).not.toContain("createModel");
    expect(actions).not.toContain("modelFieldAdd");
    expect(actions).not.toContain("updateModelTemplates");
    expect(actions).not.toContain("updateModelStyling");
  });

  it("rejects a mapped field that no longer exists without any model mutation", async () => {
    const actions: string[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { action: string };
      actions.push(request.action);
      const resultByAction: Record<string, unknown> = {
        deckNames: ["Hebrew RU"],
        modelNames: ["Hebrew Existing"],
        modelFieldNames: ["Hebrew", "Russian", "Lemma"],
      };
      return new Response(JSON.stringify({
        result: resultByAction[request.action] ?? null,
        error: null,
      }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      new AnkiClient("http://127.0.0.1:8765", fetcher)
        .ensureDeckAndModel(mappedProfile()),
    ).rejects.toThrow('Mapped Anki field "Example"');

    expect(actions).toEqual(["deckNames", "modelNames", "modelFieldNames"]);
  });

  it("updates only explicitly mapped user-owned fields and maintains the reserved identity tag", async () => {
    const requests: Array<{ action: string; params: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      requests.push(request);

      const result = request.action === "notesInfo"
        ? [{ noteId: 4242, modelName: "Hebrew Existing" }]
        : null;
      return new Response(JSON.stringify({ result, error: null }), { status: 200 });
    }) as unknown as typeof fetch;

    const noteId = await new AnkiClient("http://127.0.0.1:8765", fetcher)
      .upsert(item(), mappedProfile(), 4242);

    expect(noteId).toBe(4242);
    expect(requests.map(({ action }) => action)).toEqual([
      "notesInfo",
      "addTags",
      "updateNoteFields",
    ]);
    expect(requests[1]?.params).toEqual({
      notes: [4242],
      tags: "collector::id::unit-1",
    });
    expect(requests[2]?.params).toEqual({
      note: {
        id: 4242,
        fields: {
          Hebrew: "Hoy […] salir a caminar por el centro.",
          Russian: "tengo ganas de\n\nCanonical: tener ganas de\n\nWant / feel like doing something.",
          Lemma: "tener ganas de",
          Example: "Hoy tengo ganas de salir a caminar por el centro.",
        },
      },
    });
    expect(JSON.stringify(requests)).not.toContain("Private Notes");
  });

  it("recovers a stale mapped note id by reserved Collector identity tag", async () => {
    const requests: Array<{ action: string; params: Record<string, unknown> }> = [];
    let notesInfoCalls = 0;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      requests.push(request);

      let result: unknown = null;
      if (request.action === "notesInfo") {
        notesInfoCalls += 1;
        result = notesInfoCalls === 1
          ? [{}]
          : [{ noteId: 777, modelName: "Hebrew Existing" }];
      } else if (request.action === "findNotes") {
        result = [777];
      }

      return new Response(JSON.stringify({ result, error: null }), { status: 200 });
    }) as unknown as typeof fetch;

    const noteId = await new AnkiClient("http://127.0.0.1:8765", fetcher)
      .upsert(item(), mappedProfile(), 4242);

    expect(noteId).toBe(777);
    expect(requests.map(({ action }) => action)).toEqual([
      "notesInfo",
      "findNotes",
      "notesInfo",
      "addTags",
      "updateNoteFields",
    ]);
    expect(requests[1]?.params).toEqual({
      query: "tag:collector::id::unit-1",
    });
  });

  it("creates a mapped user-owned note with only mapped fields and Collector-owned tags", async () => {
    const value = item();
    delete value.lexicalUnit.ankiNoteId;
    const requests: Array<{ action: string; params: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      requests.push(request);
      const result = request.action === "findNotes"
        ? []
        : request.action === "addNote"
          ? 9001
          : null;
      return new Response(JSON.stringify({ result, error: null }), { status: 200 });
    }) as unknown as typeof fetch;

    const noteId = await new AnkiClient("http://127.0.0.1:8765", fetcher)
      .upsert(value, mappedProfile());

    expect(noteId).toBe(9001);
    expect(requests.map(({ action }) => action)).toEqual(["findNotes", "addNote"]);
    expect(requests[1]?.params).toEqual({
      note: {
        deckName: "Hebrew RU",
        modelName: "Hebrew Existing",
        fields: {
          Hebrew: "Hoy […] salir a caminar por el centro.",
          Russian: "tengo ganas de\n\nCanonical: tener ganas de\n\nWant / feel like doing something.",
          Lemma: "tener ganas de",
          Example: "Hoy tengo ganas de salir a caminar por el centro.",
        },
        options: { allowDuplicate: true },
        tags: [
          "anki-cards-collector",
          "collector::context-production",
          "collector::id::unit-1",
        ],
      },
    });
  });

  it("refuses ambiguous reserved identity tags instead of choosing an arbitrary note", async () => {
    const value = item();
    delete value.lexicalUnit.ankiNoteId;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { action: string };
      return new Response(JSON.stringify({
        result: request.action === "findNotes" ? [10, 11] : null,
        error: null,
      }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      new AnkiClient("http://127.0.0.1:8765", fetcher)
        .upsert(value, mappedProfile()),
    ).rejects.toThrow("Multiple Anki notes match Collector identity");
  });

  it("refuses identity-tag recovery into a different user-owned note type", async () => {
    const value = item();
    delete value.lexicalUnit.ankiNoteId;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { action: string };
      const result = request.action === "findNotes"
        ? [777]
        : request.action === "notesInfo"
          ? [{ noteId: 777, modelName: "Wrong Existing Model" }]
          : null;
      return new Response(JSON.stringify({ result, error: null }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      new AnkiClient("http://127.0.0.1:8765", fetcher)
        .upsert(value, mappedProfile()),
    ).rejects.toThrow("Collector identity tag belongs to note type");
  });


  it("can recover safely after identity tagging succeeds but mapped field update fails", async () => {
    const value = item();
    const requests: Array<{ action: string; params: Record<string, unknown> }> = [];
    let phase: "first" | "retry" = "first";

    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      requests.push(request);

      if (phase === "first") {
        if (request.action === "notesInfo") {
          return new Response(JSON.stringify({
            result: [{ noteId: 4242, modelName: "Hebrew Existing" }],
            error: null,
          }), { status: 200 });
        }
        if (request.action === "updateNoteFields") {
          return new Response(JSON.stringify({
            result: null,
            error: "temporary update failure",
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ result: null, error: null }), { status: 200 });
      }

      if (request.action === "findNotes") {
        return new Response(JSON.stringify({ result: [4242], error: null }), { status: 200 });
      }
      if (request.action === "notesInfo") {
        return new Response(JSON.stringify({
          result: [{ noteId: 4242, modelName: "Hebrew Existing" }],
          error: null,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ result: null, error: null }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new AnkiClient("http://127.0.0.1:8765", fetcher);

    await expect(
      client.upsert(value, mappedProfile(), 4242),
    ).rejects.toThrow("temporary update failure");

    expect(requests.map(({ action }) => action)).toEqual([
      "notesInfo",
      "addTags",
      "updateNoteFields",
    ]);

    phase = "retry";
    requests.length = 0;

    await expect(
      client.upsert(value, mappedProfile()),
    ).resolves.toBe(4242);

    expect(requests.map(({ action }) => action)).toEqual([
      "notesInfo",
      "findNotes",
      "notesInfo",
      "addTags",
      "updateNoteFields",
    ]);
    expect(requests[1]?.params).toEqual({
      query: "tag:collector::id::unit-1",
    });
  });

});
