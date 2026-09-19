import type { AnkiClient } from "./client";
import type { AnkiCatalogCache } from "./catalog-cache";

export type AnkiObjectId = string | number;

export interface AnkiCatalogDeck {
  id: AnkiObjectId;
  name: string;
}

export interface AnkiCatalogModelSummary {
  id: AnkiObjectId;
  name: string;
}

export interface AnkiCatalogSnapshot {
  ankiConnectVersion: number;
  decks: AnkiCatalogDeck[];
  models: AnkiCatalogModelSummary[];
  refreshedAt: string;
}

export interface AnkiCatalogTemplate {
  name: string;
  front: string;
  back: string;
  frontFields: string[];
  backFields: string[];
}

export interface AnkiModelDetail {
  id?: AnkiObjectId;
  name: string;
  fields: string[];
  templates: AnkiCatalogTemplate[];
  css: string;
  refreshedAt: string;
}

export type AnkiCatalogRefreshResult =
  | { kind: "live"; snapshot: AnkiCatalogSnapshot }
  | { kind: "stale"; snapshot: AnkiCatalogSnapshot; error: string }
  | { kind: "unavailable"; snapshot: null; error: string };

export type AnkiModelInspectionResult =
  | { kind: "live"; detail: AnkiModelDetail }
  | { kind: "stale"; detail: AnkiModelDetail; error: string }
  | { kind: "unavailable"; detail: null; error: string };

export interface AnkiCatalogClient {
  ping(): Promise<number>;
  deckNamesAndIds(): Promise<Record<string, unknown>>;
  modelNamesAndIds(): Promise<Record<string, unknown>>;
  modelFieldNames(modelName: string): Promise<unknown>;
  modelFieldsOnTemplates(modelName: string): Promise<unknown>;
  modelTemplates(modelName: string): Promise<unknown>;
  modelStyling(modelName: string): Promise<unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Anki discovery error.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeObjectId(value: unknown, label: string): AnkiObjectId {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new Error(`${label} has an invalid Anki ID.`);
}

function normalizeNamedIds(
  value: unknown,
  label: string,
): Array<{ id: AnkiObjectId; name: string }> {
  if (!isRecord(value)) throw new Error(`${label} response must be an object.`);

  return Object.entries(value)
    .map(([name, id]) => ({
      name,
      id: normalizeObjectId(id, `${label} entry "${name}"`),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} response must be a string array.`);
  }
  return [...value];
}

function normalizeTemplates(
  templatesValue: unknown,
  fieldsValue: unknown,
): AnkiCatalogTemplate[] {
  if (!isRecord(templatesValue)) {
    throw new Error("modelTemplates response must be an object.");
  }
  if (!isRecord(fieldsValue)) {
    throw new Error("modelFieldsOnTemplates response must be an object.");
  }

  return Object.entries(templatesValue)
    .map(([name, templateValue]) => {
      if (!isRecord(templateValue)) {
        throw new Error(`Template "${name}" must be an object.`);
      }

      const front = templateValue.Front;
      const back = templateValue.Back;
      if (typeof front !== "string" || typeof back !== "string") {
        throw new Error(`Template "${name}" is missing Front/Back HTML.`);
      }

      const fieldsForTemplate = fieldsValue[name];
      if (
        !Array.isArray(fieldsForTemplate)
        || fieldsForTemplate.length !== 2
      ) {
        throw new Error(`Template "${name}" has invalid field-usage metadata.`);
      }

      return {
        name,
        front,
        back,
        frontFields: normalizeStringArray(
          fieldsForTemplate[0],
          `Template "${name}" front fields`,
        ),
        backFields: normalizeStringArray(
          fieldsForTemplate[1],
          `Template "${name}" back fields`,
        ),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeStyling(value: unknown): string {
  if (!isRecord(value) || typeof value.css !== "string") {
    throw new Error("modelStyling response must contain CSS.");
  }
  return value.css;
}

export class AnkiCatalogService {
  private snapshot: AnkiCatalogSnapshot | null = null;
  private readonly modelDetails = new Map<string, AnkiModelDetail>();

  constructor(
    private readonly client: AnkiCatalogClient,
    private readonly now: () => Date = () => new Date(),
    private readonly cache?: AnkiCatalogCache,
  ) {}

  currentSnapshot(): AnkiCatalogSnapshot | null {
    return this.snapshot;
  }

  async refresh(): Promise<AnkiCatalogRefreshResult> {
    try {
      const ankiConnectVersion = await this.client.ping();
      const [rawDecks, rawModels] = await Promise.all([
        this.client.deckNamesAndIds(),
        this.client.modelNamesAndIds(),
      ]);

      const snapshot: AnkiCatalogSnapshot = {
        ankiConnectVersion,
        decks: normalizeNamedIds(rawDecks, "deckNamesAndIds"),
        models: normalizeNamedIds(rawModels, "modelNamesAndIds"),
        refreshedAt: this.now().toISOString(),
      };

      this.snapshot = snapshot;
      try {
        await this.cache?.saveSnapshot(snapshot);
      } catch {
        // Discovery remains live even if the optional stale-cache write fails.
      }
      return { kind: "live", snapshot };
    } catch (error) {
      const message = errorMessage(error);
      if (!this.snapshot && this.cache) {
        try {
          this.snapshot = await this.cache.loadSnapshot();
        } catch {
          // Ignore cache read errors and report live discovery failure below.
        }
      }
      if (this.snapshot) {
        return { kind: "stale", snapshot: this.snapshot, error: message };
      }
      return { kind: "unavailable", snapshot: null, error: message };
    }
  }

  async inspectModel(modelName: string): Promise<AnkiModelInspectionResult> {
    try {
      const [fieldsValue, fieldsOnTemplates, templatesValue, stylingValue] =
        await Promise.all([
          this.client.modelFieldNames(modelName),
          this.client.modelFieldsOnTemplates(modelName),
          this.client.modelTemplates(modelName),
          this.client.modelStyling(modelName),
        ]);

      const modelId = this.snapshot?.models.find(
        (model) => model.name === modelName,
      )?.id;

      const detail: AnkiModelDetail = {
        ...(modelId === undefined ? {} : { id: modelId }),
        name: modelName,
        fields: normalizeStringArray(
          fieldsValue,
          `modelFieldNames for "${modelName}"`,
        ),
        templates: normalizeTemplates(templatesValue, fieldsOnTemplates),
        css: normalizeStyling(stylingValue),
        refreshedAt: this.now().toISOString(),
      };

      this.modelDetails.set(modelName, detail);
      try {
        await this.cache?.saveModelDetail(detail);
      } catch {
        // Inspection remains live even if the optional stale-cache write fails.
      }
      return { kind: "live", detail };
    } catch (error) {
      const message = errorMessage(error);
      let cached = this.modelDetails.get(modelName) ?? null;
      if (!cached && this.cache) {
        try {
          cached = await this.cache.loadModelDetail(modelName);
          if (cached) this.modelDetails.set(modelName, cached);
        } catch {
          // Ignore cache read errors and report live inspection failure below.
        }
      }
      if (cached) return { kind: "stale", detail: cached, error: message };
      return { kind: "unavailable", detail: null, error: message };
    }
  }
}

export function createAnkiCatalogService(client: AnkiClient): AnkiCatalogService {
  return new AnkiCatalogService(client);
}
