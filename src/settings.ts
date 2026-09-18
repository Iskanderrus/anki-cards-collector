import type { CollectorSettings } from "./core/types";

export const DEFAULT_SETTINGS: CollectorSettings = {
  defaultLanguage: "und",
  deckName: "Collector Inbox",
  modelName: "Collector Basic",
};

export async function loadSettings(): Promise<CollectorSettings> {
  const stored = await chrome.storage.local.get("collectorSettings");
  return {
    ...DEFAULT_SETTINGS,
    ...(stored.collectorSettings as Partial<CollectorSettings> | undefined),
  };
}

export async function saveSettings(settings: CollectorSettings): Promise<void> {
  await chrome.storage.local.set({ collectorSettings: settings });
}
