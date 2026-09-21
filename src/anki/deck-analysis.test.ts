import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DECK_ANALYSIS_SAMPLE_SIZE,
  MAX_REPRESENTATIVE_HTML_CHARS,
  DeckAnalysisService,
  deckScopedSearch,
  selectDeterministicCardSample,
  type DeckAnalysisClient,
} from "./deck-analysis";

function client(
  overrides: Partial<DeckAnalysisClient> = {},
): DeckAnalysisClient {
  return {
    findCards: vi.fn(async () => []),
    cardsInfo: vi.fn(async () => []),
    ...overrides,
  };
}

function card(
  cardId: number,
  modelName: string,
  ord = 0,
  deckName = "Hebrew RU",
) {
  return {
    cardId,
    deckName,
    modelName,
    question: `<div>front-${cardId}</div>`,
    answer: `<div>back-${cardId}</div>`,
    css: `.card-${cardId} { font-size: 20px; }`,
    ord,
  };
}

describe("DeckAnalysisService", () => {
  it("aggregates mixed-model sample counts without selecting a winner", async () => {
    const fake = client({
      findCards: vi.fn(async () => [6, 1, 5, 2, 4, 3]),
      cardsInfo: vi.fn(async () => [
        card(1, "Hebrew Vocabulary", 0),
        card(2, "Hebrew Vocabulary", 0),
        card(3, "Hebrew Vocabulary", 1),
        card(4, "Hebrew Verbs", 0),
        card(5, "Hebrew Verbs", 0),
        card(6, "Basic", 0),
      ]),
    });

    const service = new DeckAnalysisService(
      fake,
      6,
      4,
      () => new Date("2026-09-20T20:00:00.000Z"),
    );
    const result = await service.analyze("Hebrew RU");

    expect(result).toMatchObject({
      deckName: "Hebrew RU",
      totalCardCount: 6,
      sampledCardCount: 6,
      inspectedCardCount: 6,
      unavailableSampleCount: 0,
      truncated: false,
      analyzedAt: "2026-09-20T20:00:00.000Z",
    });
    expect(result.models.map((model) => [model.modelName, model.sampledCount])).toEqual([
      ["Hebrew Vocabulary", 3],
      ["Hebrew Verbs", 2],
      ["Basic", 1],
    ]);
    expect(result.models[0]?.representatives.map((rep) => rep.templateOrdinal)).toEqual([0, 1]);
  });

  it("bounds a huge deck to deterministic evenly-spaced cardsInfo input", async () => {
    const ids = Array.from({ length: 100 }, (_, index) => 100 - index);
    const cardsInfo = vi.fn(async (sample: unknown) =>
      (sample as number[]).map((id) => card(id, "Hebrew Vocabulary"))
    );
    const fake = client({
      findCards: vi.fn(async () => ids),
      cardsInfo,
    });

    const result = await new DeckAnalysisService(fake, 5).analyze("Hebrew RU");

    expect(cardsInfo).toHaveBeenCalledWith([1, 25, 50, 75, 100]);
    expect(result.totalCardCount).toBe(100);
    expect(result.sampledCardCount).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it("does not call cardsInfo for an empty deck", async () => {
    const fake = client();
    const result = await new DeckAnalysisService(fake).analyze("Empty");

    expect(fake.cardsInfo).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      totalCardCount: 0,
      sampledCardCount: 0,
      inspectedCardCount: 0,
      models: [],
      truncated: false,
    });
  });

  it("keeps one representative per sampled model/template ordinal", async () => {
    const fake = client({
      findCards: vi.fn(async () => [1, 2, 3, 4, 5]),
      cardsInfo: vi.fn(async () => [
        card(1, "Multi", 0),
        card(2, "Multi", 0),
        card(3, "Multi", 1),
        card(4, "Multi", 2),
        card(5, "Multi", 2),
      ]),
    });

    const result = await new DeckAnalysisService(fake, 5, 4).analyze("Hebrew RU");
    expect(result.models[0]?.representatives.map((rep) => [
      rep.cardId,
      rep.templateOrdinal,
    ])).toEqual([
      [1, 0],
      [3, 1],
      [4, 2],
    ]);
  });

  it("supports a cloze model as ordinary read-only evidence", async () => {
    const fake = client({
      findCards: vi.fn(async () => [1]),
      cardsInfo: vi.fn(async () => [{
        ...card(1, "Cloze", 0),
        question: "<span class=cloze>[...]</span> text",
        answer: "<span class=cloze>target</span> text",
      }]),
    });

    const result = await new DeckAnalysisService(fake).analyze("Hebrew RU");
    expect(result.models).toEqual([
      expect.objectContaining({
        modelName: "Cloze",
        sampledCount: 1,
        representatives: [
          expect.objectContaining({
            question: "<span class=cloze>[...]</span> text",
            answer: "<span class=cloze>target</span> text",
          }),
        ],
      }),
    ]);
  });

  it("counts missing, malformed, or moved cards as unavailable sample evidence", async () => {
    const fake = client({
      findCards: vi.fn(async () => [1, 2, 3, 4]),
      cardsInfo: vi.fn(async () => [
        card(1, "Good"),
        { ...card(2, "Bad"), question: null },
        card(3, "Moved", 0, "Other Deck"),
        // card 4 disappeared between findCards and cardsInfo
      ]),
    });

    const result = await new DeckAnalysisService(fake, 4).analyze("Hebrew RU");
    expect(result.inspectedCardCount).toBe(1);
    expect(result.unavailableSampleCount).toBe(3);
    expect(result.models.map((model) => model.modelName)).toEqual(["Good"]);
  });

  it("deduplicates and samples card IDs deterministically", () => {
    expect(selectDeterministicCardSample(
      [10, 2, 8, 2, 6, 4, 10],
      3,
    )).toEqual([2, 6, 10]);

    expect(selectDeterministicCardSample(
      Array.from({ length: 60 }, (_, index) => index + 1),
    )).toHaveLength(DEFAULT_DECK_ANALYSIS_SAMPLE_SIZE);
  });

  it("quotes and escapes a deck-scoped Anki search", () => {
    expect(deckScopedSearch('Hebrew "Primary" \\ Archive')).toBe(
      'deck:"Hebrew \\"Primary\\" \\\\ Archive"',
    );
  });

  it("rejects malformed findCards/cardsInfo responses", async () => {
    await expect(
      new DeckAnalysisService(client({
        findCards: vi.fn(async () => ({ nope: true })),
      })).analyze("Hebrew RU"),
    ).rejects.toThrow("findCards response must be an array");

    await expect(
      new DeckAnalysisService(client({
        findCards: vi.fn(async () => [1]),
        cardsInfo: vi.fn(async () => ({ nope: true })),
      })).analyze("Hebrew RU"),
    ).rejects.toThrow("cardsInfo response must be an array");
  });

  it("treats selected deck subdecks as in-scope Anki evidence", async () => {
    const fake = client({
      findCards: vi.fn(async () => [1, 2]),
      cardsInfo: vi.fn(async () => [
        card(1, "Parent Model", 0, "Hebrew RU"),
        card(2, "Child Model", 0, "Hebrew RU::Verbs"),
      ]),
    });

    const result = await new DeckAnalysisService(fake, 2).analyze("Hebrew RU");
    expect(result.inspectedCardCount).toBe(2);
    expect(result.models.map((model) => model.modelName).sort()).toEqual([
      "Child Model",
      "Parent Model",
    ]);
  });

  it("rejects oversized representative HTML as unavailable evidence", async () => {
    const fake = client({
      findCards: vi.fn(async () => [1]),
      cardsInfo: vi.fn(async () => [{
        ...card(1, "Huge"),
        question: "x".repeat(MAX_REPRESENTATIVE_HTML_CHARS + 1),
      }]),
    });

    const result = await new DeckAnalysisService(fake).analyze("Hebrew RU");
    expect(result.inspectedCardCount).toBe(0);
    expect(result.unavailableSampleCount).toBe(1);
    expect(result.models).toEqual([]);
  });

});
