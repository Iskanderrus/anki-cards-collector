import { describe, expect, it, vi } from "vitest";
import type {
  CollectedItem,
  CollectorSettings,
  ExportBinding,
  ExportProfile,
} from "../core/types";
import { exportBatch, type AnkiExportClient, type ExportProgress } from "./batch";

function item(id: string, text: string, language: string): CollectedItem {
  return {
    lexicalUnit: {
      id,
      contentKey: `${language}::${text.toLowerCase()}`,
      canonicalText: text,
      normalizedCanonicalText: text.toLowerCase(),
      language,
      note: "",
      status: "ready",
      createdAt: "2026-09-19T00:00:00Z",
      updatedAt: "2026-09-19T00:00:00Z",
    },
    occurrences: [],
  };
}

const profiles: ExportProfile[] = [
  {
    id: "he-profile",
    name: "Hebrew",
    deckName: "Hebrew RU",
    modelName: "Collector Basic",
    mode: "collector-managed",
  },
  {
    id: "sr-profile",
    name: "Serbian",
    deckName: "Serbian RU",
    modelName: "Collector Basic",
    mode: "collector-managed",
  },
  {
    id: "fallback-profile",
    name: "Fallback",
    deckName: "Collector Inbox",
    modelName: "Collector Basic",
    mode: "collector-managed",
  },
];

const settings: CollectorSettings = {
  defaultLanguage: "he",
  sourceUrlMode: "sanitized",
  exportProfiles: profiles,
  languageRoutes: [
    { language: "he", profileId: "he-profile" },
    { language: "sr", profileId: "sr-profile" },
  ],
  fallbackProfileId: "fallback-profile",
};

function client(overrides: Partial<AnkiExportClient> = {}): AnkiExportClient {
  return {
    ping: vi.fn(async () => 6),
    ensureDeckAndModel: vi.fn(async () => undefined),
    upsert: vi.fn(async (current) => current.lexicalUnit.id.length + 100),
    ...overrides,
  };
}

describe("exportBatch profile routing", () => {
  it("routes a mixed-language batch through different profiles", async () => {
    const exportClient = client();
    const persisted: ExportBinding[] = [];
    const progress: ExportProgress[] = [];

    const report = await exportBatch(
      [
        item("he-one", "שלום", "he"),
        item("sr-one", "zdravo", "sr"),
        item("es-one", "hola", "es"),
      ],
      settings,
      new Map(),
      exportClient,
      async (binding) => {
        persisted.push(binding);
      },
      (value) => progress.push(value),
    );

    expect(exportClient.ensureDeckAndModel).toHaveBeenCalledTimes(3);
    expect(exportClient.ensureDeckAndModel).toHaveBeenCalledWith(profiles[0]);
    expect(exportClient.ensureDeckAndModel).toHaveBeenCalledWith(profiles[1]);
    expect(exportClient.ensureDeckAndModel).toHaveBeenCalledWith(profiles[2]);

    expect(exportClient.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ lexicalUnit: expect.objectContaining({ id: "he-one" }) }),
      profiles[0],
      undefined,
    );
    expect(exportClient.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ lexicalUnit: expect.objectContaining({ id: "sr-one" }) }),
      profiles[1],
      undefined,
    );
    expect(exportClient.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ lexicalUnit: expect.objectContaining({ id: "es-one" }) }),
      profiles[2],
      undefined,
    );

    expect(persisted.map((binding) => [binding.lexicalUnitId, binding.profileId])).toEqual([
      ["he-one", "he-profile"],
      ["sr-one", "sr-profile"],
      ["es-one", "fallback-profile"],
    ]);
    expect(report).toMatchObject({ total: 3, exported: 3, failed: 0, warnings: 0 });
    expect(progress.at(-1)).toEqual({ completed: 3, total: 3 });
  });

  it("lets an existing binding override a changed language route", async () => {
    const current = item("he-one", "שלום", "he");
    const binding: ExportBinding = {
      lexicalUnitId: current.lexicalUnit.id,
      profileId: "sr-profile",
      ankiNoteId: 4242,
      deckName: "Serbian RU",
      modelName: "Collector Basic",
      updatedAt: "2026-09-19T10:00:00Z",
    };
    const exportClient = client();

    await exportBatch(
      [current],
      settings,
      new Map([[current.lexicalUnit.id, binding]]),
      exportClient,
      async () => undefined,
    );

    expect(exportClient.ensureDeckAndModel).toHaveBeenCalledWith(profiles[1]);
    expect(exportClient.upsert).toHaveBeenCalledWith(current, profiles[1], 4242);
  });

  it("isolates profile setup failure while exporting other profile groups", async () => {
    const ensureDeckAndModel = vi.fn(async (profile: ExportProfile) => {
      if (profile.id === "sr-profile") throw new Error("Serbian deck unavailable");
    });
    const exportClient = client({ ensureDeckAndModel });

    const report = await exportBatch(
      [
        item("he-one", "שלום", "he"),
        item("sr-one", "zdravo", "sr"),
      ],
      settings,
      new Map(),
      exportClient,
      async () => undefined,
    );

    expect(report).toMatchObject({ total: 2, exported: 1, failed: 1 });
    expect(report.results[0]?.kind).toBe("exported");
    expect(report.results[1]).toMatchObject({
      kind: "failed",
      error: "Serbian deck unavailable",
    });
  });

  it("reports a local binding persistence warning without calling Anki export a failure", async () => {
    const report = await exportBatch(
      [item("he-one", "שלום", "he")],
      settings,
      new Map(),
      client({ upsert: vi.fn(async () => 4242) }),
      async () => {
        throw new Error("IndexedDB unavailable");
      },
    );

    expect(report).toMatchObject({
      total: 1,
      exported: 1,
      failed: 0,
      warnings: 1,
    });
    expect(report.results[0]).toMatchObject({
      kind: "exported_untracked",
      noteId: 4242,
      profileId: "he-profile",
      deckName: "Hebrew RU",
    });
  });

  it("stops before routing when Anki is offline", async () => {
    const exportClient = client({
      ping: vi.fn(async () => {
        throw new Error("Anki is offline");
      }),
    });

    await expect(exportBatch(
      [item("he-one", "שלום", "he")],
      settings,
      new Map(),
      exportClient,
      async () => undefined,
    )).rejects.toThrow("Anki is offline");

    expect(exportClient.ensureDeckAndModel).not.toHaveBeenCalled();
    expect(exportClient.upsert).not.toHaveBeenCalled();
  });
});
