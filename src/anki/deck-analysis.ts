import type { AnkiObjectId } from "./catalog";

export const DEFAULT_DECK_ANALYSIS_SAMPLE_SIZE = 24;
export const DEFAULT_MAX_REPRESENTATIVES_PER_MODEL = 4;
export const MAX_REPRESENTATIVE_HTML_CHARS = 100_000;
export const MAX_REPRESENTATIVE_CSS_CHARS = 100_000;

export interface DeckAnalysisClient {
  findCards(query: string): Promise<unknown>;
  cardsInfo(cards: AnkiObjectId[]): Promise<unknown>;
}

export interface RepresentativeAnkiCard {
  cardId: AnkiObjectId;
  deckName: string;
  modelName: string;
  question: string;
  answer: string;
  css: string;
  templateOrdinal?: number;
}

export interface DeckModelSample {
  modelName: string;
  sampledCount: number;
  representatives: RepresentativeAnkiCard[];
}

export interface DeckAnalysis {
  deckName: string;
  totalCardCount: number;
  requestedSampleCount: number;
  sampledCardCount: number;
  inspectedCardCount: number;
  unavailableSampleCount: number;
  truncated: boolean;
  models: DeckModelSample[];
  analyzedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeObjectId(value: unknown, label: string): AnkiObjectId {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(`${label} has an invalid Anki card ID.`);
}

function idKey(value: AnkiObjectId): string {
  return `${typeof value}:${String(value)}`;
}

function compareIds(left: AnkiObjectId, right: AnkiObjectId): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeSortedCardIds(value: unknown): AnkiObjectId[] {
  if (!Array.isArray(value)) {
    throw new Error("findCards response must be an array.");
  }

  const unique = new Map<string, AnkiObjectId>();
  value.forEach((entry, index) => {
    const id = normalizeObjectId(entry, `findCards[${index}]`);
    unique.set(idKey(id), id);
  });

  return [...unique.values()].sort(compareIds);
}

function sampleSortedCardIds(
  ids: readonly AnkiObjectId[],
  limit: number,
): AnkiObjectId[] {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("Deck analysis sample size must be a positive integer.");
  }
  if (ids.length <= limit) return [...ids];
  if (limit === 1) return [ids[0]!];

  const sample: AnkiObjectId[] = [];
  for (let i = 0; i < limit; i += 1) {
    const index = Math.floor((i * (ids.length - 1)) / (limit - 1));
    sample.push(ids[index]!);
  }
  return sample;
}

export function selectDeterministicCardSample(
  value: unknown,
  limit = DEFAULT_DECK_ANALYSIS_SAMPLE_SIZE,
): AnkiObjectId[] {
  return sampleSortedCardIds(normalizeSortedCardIds(value), limit);
}

export function deckScopedSearch(deckName: string): string {
  const normalized = deckName.trim();
  if (!normalized) throw new Error("Choose an Anki deck to inspect.");
  const escaped = normalized.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `deck:"${escaped}"`;
}

function normalizeCard(
  value: unknown,
  expectedDeckName: string,
): RepresentativeAnkiCard | null {
  if (!isRecord(value)) return null;

  let cardId: AnkiObjectId;
  try {
    cardId = normalizeObjectId(value.cardId, "cardsInfo.cardId");
  } catch {
    return null;
  }

  const deckName = value.deckName;
  const modelName = value.modelName;
  const question = value.question;
  const answer = value.answer;
  const css = value.css;

  const inDeckScope =
    typeof deckName === "string"
    && (
      deckName === expectedDeckName
      || deckName.startsWith(`${expectedDeckName}::`)
    );

  if (
    !inDeckScope
    || typeof modelName !== "string"
    || !modelName.trim()
    || typeof question !== "string"
    || typeof answer !== "string"
    || typeof css !== "string"
    || question.length > MAX_REPRESENTATIVE_HTML_CHARS
    || answer.length > MAX_REPRESENTATIVE_HTML_CHARS
    || css.length > MAX_REPRESENTATIVE_CSS_CHARS
  ) return null;

  const ord = value.ord;
  const templateOrdinal =
    typeof ord === "number" && Number.isSafeInteger(ord) && ord >= 0
      ? ord
      : undefined;

  return {
    cardId,
    deckName,
    modelName,
    question,
    answer,
    css,
    ...(templateOrdinal === undefined ? {} : { templateOrdinal }),
  };
}

function representativeKey(card: RepresentativeAnkiCard): string {
  return `${card.modelName}\u0000${card.templateOrdinal ?? "unknown"}`;
}

export class DeckAnalysisService {
  constructor(
    private readonly client: DeckAnalysisClient,
    private readonly sampleSize = DEFAULT_DECK_ANALYSIS_SAMPLE_SIZE,
    private readonly maxRepresentativesPerModel = DEFAULT_MAX_REPRESENTATIVES_PER_MODEL,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!Number.isSafeInteger(sampleSize) || sampleSize < 1) {
      throw new Error("Deck analysis sample size must be a positive integer.");
    }
    if (!Number.isSafeInteger(maxRepresentativesPerModel) || maxRepresentativesPerModel < 1) {
      throw new Error("Representative limit must be a positive integer.");
    }
  }

  async analyze(deckName: string): Promise<DeckAnalysis> {
    const rawIds = await this.client.findCards(deckScopedSearch(deckName));
    if (!Array.isArray(rawIds)) {
      throw new Error("findCards response must be an array.");
    }

    const allIds = normalizeSortedCardIds(rawIds);
    const sampledIds = sampleSortedCardIds(allIds, this.sampleSize);

    if (sampledIds.length === 0) {
      return {
        deckName,
        totalCardCount: allIds.length,
        requestedSampleCount: this.sampleSize,
        sampledCardCount: 0,
        inspectedCardCount: 0,
        unavailableSampleCount: 0,
        truncated: false,
        models: [],
        analyzedAt: this.now().toISOString(),
      };
    }

    const rawCards = await this.client.cardsInfo(sampledIds);
    if (!Array.isArray(rawCards)) {
      throw new Error("cardsInfo response must be an array.");
    }

    const sampledKeys = new Set(sampledIds.map(idKey));
    const cardsById = new Map<string, RepresentativeAnkiCard>();
    for (const raw of rawCards) {
      const card = normalizeCard(raw, deckName);
      if (!card) continue;
      const key = idKey(card.cardId);
      if (!sampledKeys.has(key) || cardsById.has(key)) continue;
      cardsById.set(key, card);
    }

    const inspected = sampledIds
      .map((id) => cardsById.get(idKey(id)))
      .filter((card): card is RepresentativeAnkiCard => card !== undefined);

    const modelCounts = new Map<string, number>();
    const representativeSeen = new Set<string>();
    const representatives = new Map<string, RepresentativeAnkiCard[]>();

    for (const card of inspected) {
      modelCounts.set(card.modelName, (modelCounts.get(card.modelName) ?? 0) + 1);

      const key = representativeKey(card);
      const modelRepresentatives = representatives.get(card.modelName) ?? [];
      if (
        !representativeSeen.has(key)
        && modelRepresentatives.length < this.maxRepresentativesPerModel
      ) {
        representativeSeen.add(key);
        modelRepresentatives.push(card);
        representatives.set(card.modelName, modelRepresentatives);
      }
    }

    const models = [...modelCounts.entries()]
      .map(([modelName, sampledCount]): DeckModelSample => ({
        modelName,
        sampledCount,
        representatives: representatives.get(modelName) ?? [],
      }))
      .sort((left, right) =>
        right.sampledCount - left.sampledCount
        || left.modelName.localeCompare(right.modelName)
      );

    return {
      deckName,
      totalCardCount: allIds.length,
      requestedSampleCount: this.sampleSize,
      sampledCardCount: sampledIds.length,
      inspectedCardCount: inspected.length,
      unavailableSampleCount: sampledIds.length - inspected.length,
      truncated: allIds.length > sampledIds.length,
      models,
      analyzedAt: this.now().toISOString(),
    };
  }
}
