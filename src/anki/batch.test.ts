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
    preflight: vi.fn(async () => undefined),
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

    const reservations = persisted.filter((binding) => binding.ankiNoteId === undefined);
    const completed = persisted.filter((binding) => binding.ankiNoteId !== undefined);
    expect(reservations.map((binding) => [binding.lexicalUnitId, binding.profileId])).toEqual([
      ["he-one", "he-profile"],
      ["sr-one", "sr-profile"],
      ["es-one", "fallback-profile"],
    ]);
    expect(completed.map((binding) => [binding.lexicalUnitId, binding.profileId])).toEqual([
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
      state: "exported",
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

  it("keeps the destination reservation when saving the final note id fails", async () => {
    const persisted: ExportBinding[] = [];
    let writes = 0;
    const exportClient = client({ upsert: vi.fn(async () => 4242) });

    const report = await exportBatch(
      [item("he-one", "שלום", "he")],
      settings,
      new Map(),
      exportClient,
      async (binding) => {
        writes += 1;
        if (writes === 2) throw new Error("IndexedDB unavailable");
        persisted.push(binding);
      },
    );

    expect(exportClient.upsert).toHaveBeenCalledOnce();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      lexicalUnitId: "he-one",
      profileId: "he-profile",
      state: "reserved",
      deckName: "Hebrew RU",
      modelName: "Collector Basic",
    });
    expect(persisted[0]?.ankiNoteId).toBeUndefined();

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

  it("does not mutate Anki when the destination reservation cannot be persisted", async () => {
    const exportClient = client();

    const report = await exportBatch(
      [item("he-one", "שלום", "he")],
      settings,
      new Map(),
      exportClient,
      async () => {
        throw new Error("IndexedDB unavailable");
      },
    );

    expect(exportClient.upsert).not.toHaveBeenCalled();
    expect(report).toMatchObject({ total: 1, exported: 0, failed: 1, warnings: 0 });
    expect(report.results[0]).toMatchObject({
      kind: "failed",
      error: "IndexedDB unavailable",
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

  async function verifyPinnedAndCurrentProfileStaySeparated(order: "old-first" | "new-first") {
    const oldItem = item("he-old", "ישן", "he");
    const newItem = item("he-new", "חדש", "he");
    const oldBinding: ExportBinding = {
      lexicalUnitId: oldItem.lexicalUnit.id,
      profileId: "he-profile",
      state: "exported",
      ankiNoteId: 4242,
      deckName: "Hebrew Old",
      modelName: "Collector Basic",
      updatedAt: "2026-09-19T10:00:00Z",
    };

    const exportClient = client({
      upsert: vi.fn(async (current, profile, existingNoteId) =>
        existingNoteId ?? (profile.deckName === "Hebrew RU" ? 9001 : 9002)
      ),
    });
    const persisted: ExportBinding[] = [];

    const input = order === "old-first"
      ? [oldItem, newItem]
      : [newItem, oldItem];

    await exportBatch(
      input,
      settings,
      new Map([[oldItem.lexicalUnit.id, oldBinding]]),
      exportClient,
      async (binding) => {
        persisted.push(binding);
      },
    );

    expect(exportClient.ensureDeckAndModel).toHaveBeenCalledTimes(2);
    expect(exportClient.ensureDeckAndModel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "he-profile",
        deckName: "Hebrew Old",
        modelName: "Collector Basic",
      }),
    );
    expect(exportClient.ensureDeckAndModel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "he-profile",
        deckName: "Hebrew RU",
        modelName: "Collector Basic",
      }),
    );

    expect(exportClient.upsert).toHaveBeenCalledWith(
      oldItem,
      expect.objectContaining({ deckName: "Hebrew Old" }),
      4242,
    );
    expect(exportClient.upsert).toHaveBeenCalledWith(
      newItem,
      expect.objectContaining({ deckName: "Hebrew RU" }),
      undefined,
    );

    const finalOld = persisted.filter(
      (binding) => binding.lexicalUnitId === oldItem.lexicalUnit.id && binding.state === "exported",
    ).at(-1);
    const finalNew = persisted.filter(
      (binding) => binding.lexicalUnitId === newItem.lexicalUnit.id && binding.state === "exported",
    ).at(-1);

    expect(finalOld).toMatchObject({
      profileId: "he-profile",
      deckName: "Hebrew Old",
      ankiNoteId: 4242,
    });
    expect(finalNew).toMatchObject({
      profileId: "he-profile",
      deckName: "Hebrew RU",
    });
  }

  it("keeps old pinned and current destinations separate when the pinned item is first", async () => {
    await verifyPinnedAndCurrentProfileStaySeparated("old-first");
  });

  it("keeps old pinned and current destinations separate when the current item is first", async () => {
    await verifyPinnedAndCurrentProfileStaySeparated("new-first");
  });


  it("reconciles a surviving reservation without allowing destination reinterpretation", async () => {
    const current = item("he-one", "שלום", "he");
    const writes: ExportBinding[] = [];
    let persistCalls = 0;
    const firstClient = client({ upsert: vi.fn(async () => 4242) });

    const first = await exportBatch(
      [current],
      settings,
      new Map(),
      firstClient,
      async (binding) => {
        persistCalls += 1;
        if (persistCalls === 2) throw new Error("final binding write failed");
        writes.push(binding);
      },
    );

    expect(first.results[0]?.kind).toBe("exported_untracked");
    const reservation = writes.at(-1)!;
    expect(reservation).toMatchObject({
      state: "reserved",
      profileId: "he-profile",
      deckName: "Hebrew RU",
      modelName: "Collector Basic",
    });
    expect(reservation.ankiNoteId).toBeUndefined();

    const secondClient = client({ upsert: vi.fn(async () => 4242) });
    const reconciledWrites: ExportBinding[] = [];

    const second = await exportBatch(
      [current],
      settings,
      new Map([[current.lexicalUnit.id, reservation]]),
      secondClient,
      async (binding) => {
        reconciledWrites.push(binding);
      },
    );

    expect(secondClient.upsert).toHaveBeenCalledWith(
      current,
      expect.objectContaining({
        id: "he-profile",
        deckName: "Hebrew RU",
        modelName: "Collector Basic",
      }),
      undefined,
    );
    expect(reconciledWrites).toEqual([
      expect.objectContaining({
        lexicalUnitId: "he-one",
        profileId: "he-profile",
        state: "exported",
        ankiNoteId: 4242,
        deckName: "Hebrew RU",
        modelName: "Collector Basic",
      }),
    ]);
    expect(second).toMatchObject({ exported: 1, failed: 0, warnings: 0 });
  });


  it("routes a Ready item through an explicitly configured mapped user-owned profile", async () => {
    const mapped: ExportProfile = {
      id: "he-existing",
      name: "Hebrew existing",
      deckName: "Hebrew RU",
      deckId: "2",
      modelName: "Hebrew Existing",
      modelId: "11",
      mode: "mapped-user-model",
      fieldMapping: {
        Prompt: "Hebrew",
        Answer: "Russian",
      },
    };
    const mappedSettings: CollectorSettings = {
      ...settings,
      exportProfiles: [mapped, profiles[2]!],
      languageRoutes: [{ language: "he", profileId: mapped.id }],
    };
    const current = item("he-mapped", "שלום", "he");
    const exportClient = client({ upsert: vi.fn(async () => 7070) });
    const persisted: ExportBinding[] = [];

    const report = await exportBatch(
      [current],
      mappedSettings,
      new Map(),
      exportClient,
      async (binding) => {
        persisted.push(binding);
      },
    );

    expect(exportClient.ensureDeckAndModel).toHaveBeenCalledWith(mapped);
    expect(exportClient.upsert).toHaveBeenCalledWith(current, mapped, undefined);
    expect(persisted).toEqual([
      expect.objectContaining({
        lexicalUnitId: "he-mapped",
        profileId: "he-existing",
        state: "reserved",
        deckName: "Hebrew RU",
        deckId: "2",
        modelName: "Hebrew Existing",
        modelId: "11",
      }),
      expect.objectContaining({
        lexicalUnitId: "he-mapped",
        profileId: "he-existing",
        state: "exported",
        ankiNoteId: 7070,
        deckName: "Hebrew RU",
        deckId: "2",
        modelName: "Hebrew Existing",
        modelId: "11",
      }),
    ]);
    expect(report).toMatchObject({ exported: 1, failed: 0, warnings: 0 });
  });

  it("blocks an incomplete mapped profile before any Anki mutation", async () => {
    const incomplete: ExportProfile = {
      id: "he-existing",
      name: "Hebrew existing",
      deckName: "Hebrew RU",
      modelName: "Hebrew Existing",
      mode: "mapped-user-model",
      fieldMapping: { Prompt: "Hebrew" },
    };
    const mappedSettings: CollectorSettings = {
      ...settings,
      exportProfiles: [incomplete, profiles[2]!],
      languageRoutes: [{ language: "he", profileId: incomplete.id }],
    };
    const exportClient = client();

    const report = await exportBatch(
      [item("he-mapped", "שלום", "he")],
      mappedSettings,
      new Map(),
      exportClient,
      async () => undefined,
    );

    expect(exportClient.ensureDeckAndModel).not.toHaveBeenCalled();
    expect(exportClient.upsert).not.toHaveBeenCalled();
    expect(report.results[0]).toMatchObject({
      kind: "failed",
    });
    expect((report.results[0] as { error: string }).error).toContain("Map Collector Answer");
  });


  it("fails mapped card preflight before persisting a reservation", async () => {
    const mapped: ExportProfile = {
      id: "he-existing-preflight",
      name: "Hebrew existing",
      deckName: "Hebrew RU",
      deckId: "2",
      modelName: "Hebrew Existing",
      modelId: "11",
      mode: "mapped-user-model",
      fieldMapping: {
        Prompt: "Hebrew",
        Answer: "Russian",
      },
    };
    const mappedSettings: CollectorSettings = {
      ...settings,
      exportProfiles: [mapped, profiles[2]!],
      languageRoutes: [{ language: "he", profileId: mapped.id }],
    };
    const persisted: ExportBinding[] = [];
    const exportClient = client({
      preflight: vi.fn(async () => {
        throw new Error("Mapped export cannot produce an Anki card");
      }),
    });

    const report = await exportBatch(
      [item("he-preflight", "שלום", "he")],
      mappedSettings,
      new Map(),
      exportClient,
      async (binding) => {
        persisted.push(binding);
      },
    );

    expect(exportClient.ensureDeckAndModel).toHaveBeenCalledWith(mapped);
    expect(exportClient.preflight).toHaveBeenCalledOnce();
    expect(exportClient.upsert).not.toHaveBeenCalled();
    expect(persisted).toEqual([]);
    expect(report.results[0]).toMatchObject({
      kind: "failed",
      error: "Mapped export cannot produce an Anki card",
    });
  });

  it("does not route a mapped profile that has fields but no confirmed live IDs", async () => {
    const unconfirmed: ExportProfile = {
      id: "he-name-only",
      name: "Hebrew existing",
      deckName: "Hebrew RU",
      modelName: "Hebrew Existing",
      mode: "mapped-user-model",
      fieldMapping: {
        Prompt: "Hebrew",
        Answer: "Russian",
      },
    };
    const mappedSettings: CollectorSettings = {
      ...settings,
      exportProfiles: [unconfirmed, profiles[2]!],
      languageRoutes: [{ language: "he", profileId: unconfirmed.id }],
    };
    const exportClient = client();

    const report = await exportBatch(
      [item("he-unconfirmed", "שלום", "he")],
      mappedSettings,
      new Map(),
      exportClient,
      async () => undefined,
    );

    expect(exportClient.ensureDeckAndModel).not.toHaveBeenCalled();
    expect(exportClient.preflight).not.toHaveBeenCalled();
    expect(exportClient.upsert).not.toHaveBeenCalled();
    expect(report.results[0]).toMatchObject({ kind: "failed" });
    expect((report.results[0] as { error: string }).error).toContain(
      "requires confirmed live Anki deck and note-type IDs",
    );
  });

});
