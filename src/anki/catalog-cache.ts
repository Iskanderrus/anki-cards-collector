import type { AnkiCatalogSnapshot, AnkiModelDetail } from "./catalog";

export interface AnkiCatalogCache {
  loadSnapshot(): Promise<AnkiCatalogSnapshot | null>;
  saveSnapshot(snapshot: AnkiCatalogSnapshot): Promise<void>;
  loadModelDetail(modelName: string): Promise<AnkiModelDetail | null>;
  saveModelDetail(detail: AnkiModelDetail): Promise<void>;
}

const SNAPSHOT_KEY = "collectorAnkiCatalogSnapshotV1";
const MODEL_PREFIX = "collectorAnkiModelDetailV1:";

function modelKey(modelName: string): string {
  return `${MODEL_PREFIX}${modelName}`;
}

export class ChromeAnkiCatalogCache implements AnkiCatalogCache {
  async loadSnapshot(): Promise<AnkiCatalogSnapshot | null> {
    const stored = await chrome.storage.local.get(SNAPSHOT_KEY);
    return (stored[SNAPSHOT_KEY] as AnkiCatalogSnapshot | undefined) ?? null;
  }

  async saveSnapshot(snapshot: AnkiCatalogSnapshot): Promise<void> {
    await chrome.storage.local.set({ [SNAPSHOT_KEY]: snapshot });
  }

  async loadModelDetail(modelName: string): Promise<AnkiModelDetail | null> {
    const key = modelKey(modelName);
    const stored = await chrome.storage.local.get(key);
    return (stored[key] as AnkiModelDetail | undefined) ?? null;
  }

  async saveModelDetail(detail: AnkiModelDetail): Promise<void> {
    await chrome.storage.local.set({ [modelKey(detail.name)]: detail });
  }
}
