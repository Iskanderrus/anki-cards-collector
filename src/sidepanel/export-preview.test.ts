import { describe, expect, it, vi } from "vitest";
import type {
  CollectedItem,
  CollectorSettings,
  ExportBinding,
  ExportProfile,
} from "../core/types";
import { AnkiClient } from "../anki/client";
import {
  buildExportPreview,
  friendlyExportFailure,
  type ExportPreviewValidationClient,
} from "./export-preview";

function item(
  id: string,
  text: string,
  language: string,
  status: "inbox" | "ready" | "archived" = "ready",
): CollectedItem {
  return {
    lexicalUnit: {
      id,
      contentKey: language + ":" + text.toLowerCase(),
      canonicalText: text,
      normalizedCanonicalText: text.toLowerCase(),
      language,
      note: "",
      status,
      createdAt: "2026-09-23T12:00:00.000Z",
      updatedAt: "2026-09-23T12:00:00.000Z",
    },
    occurrences: [{
      id: id + "-occ",
      lexicalUnitId: id,
      surfaceText: text,
      normalizedSurfaceText: text.toLowerCase(),
      context: text + " in context",
      source: {
        kind: "web",
        adapter: "selection",
        url: "https://example.test/",
        title: "Example",
      },
      capturedAt: "2026-09-23T12:00:00.000Z",
    }],
  };
}

function managedProfile(id: string, name: string, deckName: string): ExportProfile {
  return {
    id,
    name,
    deckName,
    modelName: "Collector Basic",
    mode: "collector-managed",
  };
}

const hebrew = managedProfile("he-profile", "Hebrew profile", "Hebrew RU");
const serbian = managedProfile("sr-profile", "Serbian profile", "Serbian RU");

const liveOk: ExportPreviewValidationClient = {
  validateProfileLive: async () => undefined,
};

const settings: CollectorSettings = {
  defaultLanguage: "he",
  sourceUrlMode: "sanitized",
  exportProfiles: [hebrew, serbian],
  languageRoutes: [
    { language: "he", profileId: hebrew.id },
    { language: "sr", profileId: serbian.id },
  ],
  fallbackProfileId: hebrew.id,
};

describe("export preview", () => {
  it("groups Ready items by the same resolved routes used by export", async () => {
    const preview = await buildExportPreview([
      item("1", "שלום", "he"),
      item("2", "תודה", "he"),
      item("3", "dolaziti", "sr"),
      item("4", "not ready", "he", "inbox"),
    ], settings, {}, liveOk);

    expect(preview).toMatchObject({
      totalReady: 3,
      exportable: 3,
      blocked: 0,
    });
    expect(preview.groups).toEqual([
      expect.objectContaining({
        profileName: "Hebrew profile",
        deckName: "Hebrew RU",
        count: 2,
      }),
      expect.objectContaining({
        profileName: "Serbian profile",
        deckName: "Serbian RU",
        count: 1,
      }),
    ]);
  });

  it("blocks a collector-managed destination when its live deck is unavailable", async () => {
    const unavailable: ExportPreviewValidationClient = {
      validateProfileLive: async () => {
        throw new Error('Anki deck "Hebrew RU" is not available.');
      },
    };

    const preview = await buildExportPreview(
      [item("1", "שלום", "he")],
      settings,
      {},
      unavailable,
    );

    expect(preview).toMatchObject({
      totalReady: 1,
      exportable: 0,
      blocked: 1,
    });
    expect(preview.blockedItems[0]?.reason).toMatch(/destination/i);
  });

  it("honors a pinned per-item profile binding instead of recalculating its destination", async () => {
    const binding: ExportBinding = {
      lexicalUnitId: "1",
      profileId: serbian.id,
      state: "override",
      deckName: "Serbian RU",
      modelName: "Collector Basic",
      updatedAt: "2026-09-23T12:00:00.000Z",
    };

    const preview = await buildExportPreview(
      [item("1", "שלום", "he")],
      settings,
      { "1": binding },
      liveOk,
    );

    expect(preview.groups).toEqual([
      expect.objectContaining({
        profileName: "Serbian profile",
        deckName: "Serbian RU",
        count: 1,
      }),
    ]);
  });

  it("blocks an invalid mapped profile before execution", async () => {
    const mapped: ExportProfile = {
      id: "mapped",
      name: "Hebrew existing",
      language: "he",
      deckName: "Hebrew RU",
      modelName: "Hebrew Existing",
      mode: "mapped-user-model",
    };
    const mappedSettings: CollectorSettings = {
      ...settings,
      exportProfiles: [mapped],
      languageRoutes: [{ language: "he", profileId: mapped.id }],
      fallbackProfileId: mapped.id,
    };

    const preview = await buildExportPreview(
      [item("1", "שלום", "he")],
      mappedSettings,
      {},
      liveOk,
    );

    expect(preview.exportable).toBe(0);
    expect(preview.blocked).toBe(1);
    expect(preview.blockedItems[0]?.reason).toMatch(/Anki profile needs attention/i);
  });

  function configuredMappedProfile(): ExportProfile {
    return {
      id: "mapped-live",
      name: "Hebrew existing",
      language: "he",
      deckName: "Hebrew RU",
      deckId: "2",
      modelName: "Hebrew Existing",
      modelId: "11",
      mode: "mapped-user-model",
      fieldMapping: {
        Prompt: "Hebrew",
        Answer: "Russian",
        Canonical: "Lemma",
        Context: "Example",
      },
    };
  }

  function mappedPreviewClient(overrides: {
    deckId?: number;
    modelId?: number;
    fields?: string[];
    questionFields?: string[];
    front?: string;
    back?: string;
  } = {}): AnkiClient {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { action: string };
      const fields = overrides.fields ?? ["Hebrew", "Russian", "Lemma", "Example"];
      const resultByAction: Record<string, unknown> = {
        deckNamesAndIds: { "Hebrew RU": overrides.deckId ?? 2 },
        modelNamesAndIds: { "Hebrew Existing": overrides.modelId ?? 11 },
        modelFieldNames: fields,
        modelFieldsOnTemplates: {
          Recognition: [
            overrides.questionFields ?? ["Hebrew"],
            ["Hebrew", "Russian"],
          ],
        },
        modelTemplates: {
          Recognition: {
            Front: overrides.front ?? "{{Hebrew}}",
            Back: overrides.back ?? "{{FrontSide}}<hr>{{Russian}}",
          },
        },
      };
      return new Response(JSON.stringify({
        result: resultByAction[request.action] ?? null,
        error: null,
      }), { status: 200 });
    }) as unknown as typeof fetch;
    return new AnkiClient("http://127.0.0.1:8765", fetcher);
  }

  async function mappedLivePreview(overrides: Parameters<typeof mappedPreviewClient>[0]) {
    const mapped = configuredMappedProfile();
    const mappedSettings: CollectorSettings = {
      ...settings,
      exportProfiles: [mapped],
      languageRoutes: [{ language: "he", profileId: mapped.id }],
      fallbackProfileId: mapped.id,
    };
    return buildExportPreview(
      [item("live-1", "שלום", "he")],
      mappedSettings,
      {},
      mappedPreviewClient(overrides),
    );
  }

  it("PREVIEW_BLOCKS_LIVE_PROFILE_REVALIDATION for a same-name deck replacement", async () => {
    const result = await mappedLivePreview({ deckId: 22 });
    expect(result).toMatchObject({ totalReady: 1, exportable: 0, blocked: 1 });
    expect(result.blockedItems[0]?.reason).toMatch(/revalidate/i);
  });

  it("blocks a same-name note-type replacement before export", async () => {
    const result = await mappedLivePreview({ modelId: 99 });
    expect(result).toMatchObject({ exportable: 0, blocked: 1 });
    expect(result.blockedItems[0]?.reason).toMatch(/revalidate|profile needs attention/i);
  });

  it("blocks a mapped profile when a confirmed live field disappeared", async () => {
    const result = await mappedLivePreview({ fields: ["Hebrew", "Lemma", "Example"] });
    expect(result).toMatchObject({ exportable: 0, blocked: 1 });
    expect(result.blockedItems[0]?.reason).toMatch(/profile needs attention/i);
  });

  it("blocks a mapped profile when its live template becomes incompatible", async () => {
    const result = await mappedLivePreview({ front: "{{cloze:Hebrew}}" });
    expect(result).toMatchObject({ exportable: 0, blocked: 1 });
    expect(result.blockedItems[0]?.reason).toMatch(/profile needs attention/i);
  });

  it("translates normal recovery failures into user actions", () => {
    expect(friendlyExportFailure("Failed to fetch AnkiConnect")).toMatch(/Open Anki Desktop/);
    expect(friendlyExportFailure("Anki unavailable fixture")).toMatch(/Open Anki Desktop/);
    expect(friendlyExportFailure("field mapping changed")).toMatch(/revalidate/i);
    expect(friendlyExportFailure("destination deck is missing")).toMatch(/destination/i);
  });
});
