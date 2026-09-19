import { describe, expect, it, vi } from "vitest";
import {
  AnkiCatalogService,
  type AnkiCatalogClient,
  type AnkiCatalogSnapshot,
  type AnkiModelDetail,
} from "./catalog";
import type { AnkiCatalogCache } from "./catalog-cache";

function client(
  overrides: Partial<AnkiCatalogClient> = {},
): AnkiCatalogClient {
  return {
    ping: vi.fn(async () => 6),
    deckNamesAndIds: vi.fn(async () => ({
      "Spanish RU — Uruguay": 1788393000002,
      "Hebrew RU": "1789000000002",
    })),
    modelNamesAndIds: vi.fn(async () => ({
      "Hebrew Vocabulary": 1789000000001,
      "Basic": 1234567890123,
    })),
    modelFieldNames: vi.fn(async () => ["Hebrew", "Russian", "Example"]),
    modelFieldsOnTemplates: vi.fn(async () => ({
      Recognition: [["Hebrew"], ["Hebrew", "Russian", "Example"]],
      Production: [["Russian"], ["Russian", "Hebrew"]],
    })),
    modelTemplates: vi.fn(async () => ({
      Recognition: {
        Front: "{{Hebrew}}",
        Back: "{{FrontSide}}<hr>{{Russian}}<div>{{Example}}</div>",
      },
      Production: {
        Front: "{{Russian}}",
        Back: "{{FrontSide}}<hr>{{Hebrew}}",
      },
    })),
    modelStyling: vi.fn(async () => ({ css: ".card { font-size: 22px; }" })),
    ...overrides,
  };
}


function cache(
  snapshot: AnkiCatalogSnapshot | null = null,
  modelDetail: AnkiModelDetail | null = null,
): AnkiCatalogCache {
  return {
    loadSnapshot: vi.fn(async () => snapshot),
    saveSnapshot: vi.fn(async () => undefined),
    loadModelDetail: vi.fn(async () => modelDetail),
    saveModelDetail: vi.fn(async () => undefined),
  };
}

describe("AnkiCatalogService", () => {
  it("normalizes live deck/model IDs without coercing string IDs", async () => {
    const service = new AnkiCatalogService(
      client(),
      () => new Date("2026-09-19T16:00:00.000Z"),
    );

    const result = await service.refresh();

    expect(result).toEqual({
      kind: "live",
      snapshot: {
        ankiConnectVersion: 6,
        decks: [
          { id: "1789000000002", name: "Hebrew RU" },
          { id: 1788393000002, name: "Spanish RU — Uruguay" },
        ],
        models: [
          { id: 1234567890123, name: "Basic" },
          { id: 1789000000001, name: "Hebrew Vocabulary" },
        ],
        refreshedAt: "2026-09-19T16:00:00.000Z",
      },
    });
  });

  it("keeps the last successful catalog when refresh later fails", async () => {
    const fake = client();
    const service = new AnkiCatalogService(fake);

    await expect(service.refresh()).resolves.toMatchObject({ kind: "live" });
    vi.mocked(fake.ping).mockRejectedValueOnce(new Error("Anki is not running"));

    const result = await service.refresh();

    expect(result.kind).toBe("stale");
    if (result.kind === "stale") {
      expect(result.error).toBe("Anki is not running");
      expect(result.snapshot.decks).toHaveLength(2);
    }
  });

  it("reports unavailable without destroying external settings when no cache exists", async () => {
    const service = new AnkiCatalogService(client({
      ping: vi.fn(async () => {
        throw new Error("Failed to fetch");
      }),
    }));

    await expect(service.refresh()).resolves.toEqual({
      kind: "unavailable",
      snapshot: null,
      error: "Failed to fetch",
    });
    expect(service.currentSnapshot()).toBeNull();
  });

  it("normalizes model fields, templates, field usage, and styling", async () => {
    const service = new AnkiCatalogService(
      client(),
      () => new Date("2026-09-19T16:30:00.000Z"),
    );

    await service.refresh();
    const result = await service.inspectModel("Hebrew Vocabulary");

    expect(result).toEqual({
      kind: "live",
      detail: {
        id: 1789000000001,
        name: "Hebrew Vocabulary",
        fields: ["Hebrew", "Russian", "Example"],
        templates: [
          {
            name: "Production",
            front: "{{Russian}}",
            back: "{{FrontSide}}<hr>{{Hebrew}}",
            frontFields: ["Russian"],
            backFields: ["Russian", "Hebrew"],
          },
          {
            name: "Recognition",
            front: "{{Hebrew}}",
            back: "{{FrontSide}}<hr>{{Russian}}<div>{{Example}}</div>",
            frontFields: ["Hebrew"],
            backFields: ["Hebrew", "Russian", "Example"],
          },
        ],
        css: ".card { font-size: 22px; }",
        refreshedAt: "2026-09-19T16:30:00.000Z",
      },
    });
  });

  it("keeps cached model detail after a partial inspection failure", async () => {
    const fake = client();
    const service = new AnkiCatalogService(fake);

    await service.refresh();
    await expect(
      service.inspectModel("Hebrew Vocabulary"),
    ).resolves.toMatchObject({ kind: "live" });

    vi.mocked(fake.modelTemplates).mockRejectedValueOnce(
      new Error("Model disappeared"),
    );

    const result = await service.inspectModel("Hebrew Vocabulary");

    expect(result.kind).toBe("stale");
    if (result.kind === "stale") {
      expect(result.error).toBe("Model disappeared");
      expect(result.detail.name).toBe("Hebrew Vocabulary");
      expect(result.detail.templates).toHaveLength(2);
    }
  });

  it("rejects malformed catalog IDs and template metadata", async () => {
    const badCatalog = new AnkiCatalogService(client({
      deckNamesAndIds: vi.fn(async () => ({ Broken: { id: 1 } })),
    }));
    await expect(badCatalog.refresh()).resolves.toMatchObject({
      kind: "unavailable",
      error: expect.stringContaining("invalid Anki ID"),
    });

    const badTemplate = new AnkiCatalogService(client({
      modelFieldsOnTemplates: vi.fn(async () => ({
        Recognition: ["Hebrew"],
      })),
    }));
    await badTemplate.refresh();
    await expect(
      badTemplate.inspectModel("Hebrew Vocabulary"),
    ).resolves.toMatchObject({
      kind: "unavailable",
      error: expect.stringContaining("invalid field-usage metadata"),
    });
  });

  it("supports an empty Anki collection", async () => {
    const service = new AnkiCatalogService(client({
      deckNamesAndIds: vi.fn(async () => ({})),
      modelNamesAndIds: vi.fn(async () => ({})),
    }));

    await expect(service.refresh()).resolves.toMatchObject({
      kind: "live",
      snapshot: {
        decks: [],
        models: [],
      },
    });
  });
  it("restores the persisted catalog after a side-panel remount when Anki is offline", async () => {
    const persisted: AnkiCatalogSnapshot = {
      ankiConnectVersion: 6,
      decks: [{ id: 111, name: "Serbian RU" }],
      models: [{ id: 222, name: "Serbian RU — Latin Primary — Standalone v3" }],
      refreshedAt: "2026-09-19T17:00:00.000Z",
    };
    const fakeCache = cache(persisted);
    const service = new AnkiCatalogService(
      client({
        ping: vi.fn(async () => {
          throw new Error("Failed to fetch");
        }),
      }),
      () => new Date("2026-09-19T17:30:00.000Z"),
      fakeCache,
    );

    const result = await service.refresh();

    expect(result).toEqual({
      kind: "stale",
      snapshot: persisted,
      error: "Failed to fetch",
    });
    expect(fakeCache.loadSnapshot).toHaveBeenCalledOnce();
  });

  it("restores persisted model details after a remount when Anki is offline", async () => {
    const persistedDetail: AnkiModelDetail = {
      id: 222,
      name: "Serbian RU — Latin Primary — Standalone v3",
      fields: ["Serbian", "Russian", "Cyrillic", "Note", "Lesson", "TTSText"],
      templates: [{
        name: "01 Russian → Serbian Latin",
        front: "{{Russian}}",
        back: "{{Serbian}}",
        frontFields: ["Russian"],
        backFields: ["Serbian"],
      }],
      css: ".card { font-size: 20px; }",
      refreshedAt: "2026-09-19T17:00:00.000Z",
    };
    const fakeCache = cache(null, persistedDetail);
    const service = new AnkiCatalogService(
      client({
        modelFieldNames: vi.fn(async () => {
          throw new Error("Failed to fetch");
        }),
      }),
      () => new Date(),
      fakeCache,
    );

    const result = await service.inspectModel(persistedDetail.name);

    expect(result).toEqual({
      kind: "stale",
      detail: persistedDetail,
      error: "Failed to fetch",
    });
    expect(fakeCache.loadModelDetail).toHaveBeenCalledWith(persistedDetail.name);
  });

  it("does not downgrade live discovery when stale-cache persistence fails", async () => {
    const fakeCache = cache();
    vi.mocked(fakeCache.saveSnapshot).mockRejectedValueOnce(new Error("storage full"));
    const service = new AnkiCatalogService(client(), () => new Date(), fakeCache);

    await expect(service.refresh()).resolves.toMatchObject({ kind: "live" });
  });

});
