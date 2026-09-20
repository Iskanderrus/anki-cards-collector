import {
  LEGACY_DEFAULT_PROFILE_ID,
  type CollectorSettings,
  type ExportProfile,
  type LanguageRoute,
  type SourceUrlMode,
} from "./core/types";

interface LegacyCollectorSettings {
  defaultLanguage?: string;
  deckName?: string;
  modelName?: string;
  sourceUrlMode?: SourceUrlMode;
}

const DEFAULT_PROFILE: ExportProfile = {
  id: LEGACY_DEFAULT_PROFILE_ID,
  name: "Collector default",
  deckName: "Collector Inbox",
  modelName: "Collector Basic",
  mode: "collector-managed",
};

export const DEFAULT_SETTINGS: CollectorSettings = {
  defaultLanguage: "und",
  sourceUrlMode: "sanitized",
  exportProfiles: [DEFAULT_PROFILE],
  languageRoutes: [],
  fallbackProfileId: LEGACY_DEFAULT_PROFILE_ID,
};

function normalizeLanguage(language: string): string {
  return language.trim().toLowerCase() || "und";
}

function normalizedProfiles(value: unknown): ExportProfile[] {
  if (!Array.isArray(value)) return [];

  const profiles: ExportProfile[] = [];
  const ids = new Set<string>();

  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const profile = raw as Partial<ExportProfile>;
    const id = String(profile.id ?? "").trim();
    const name = String(profile.name ?? "").trim();
    const deckName = String(profile.deckName ?? "").trim();
    const modelName = String(profile.modelName ?? "").trim();
    const mode = profile.mode === "mapped-user-model" ? "mapped-user-model" : "collector-managed";
    if (!id || !name || !deckName || !modelName || ids.has(id)) continue;

    ids.add(id);
    profiles.push({
      id,
      name,
      deckName,
      ...(profile.deckId ? { deckId: String(profile.deckId) } : {}),
      modelName,
      ...(profile.modelId ? { modelId: String(profile.modelId) } : {}),
      mode,
    });
  }

  return profiles;
}

function normalizedRoutes(value: unknown, profileIds: Set<string>): LanguageRoute[] {
  if (!Array.isArray(value)) return [];

  const routes = new Map<string, LanguageRoute>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const route = raw as Partial<LanguageRoute>;
    const language = normalizeLanguage(String(route.language ?? ""));
    const profileId = String(route.profileId ?? "").trim();
    if (language === "und" || !profileIds.has(profileId)) continue;
    routes.set(language, { language, profileId });
  }
  return [...routes.values()].sort((left, right) => left.language.localeCompare(right.language));
}

export function migrateSettings(value: unknown): CollectorSettings {
  const raw = value && typeof value === "object"
    ? value as Partial<CollectorSettings> & LegacyCollectorSettings
    : {};

  let exportProfiles = normalizedProfiles(raw.exportProfiles);
  if (exportProfiles.length === 0) {
    const deckName = String(raw.deckName ?? DEFAULT_PROFILE.deckName).trim() || DEFAULT_PROFILE.deckName;
    const modelName = String(raw.modelName ?? DEFAULT_PROFILE.modelName).trim() || DEFAULT_PROFILE.modelName;
    exportProfiles = [{
      ...DEFAULT_PROFILE,
      deckName,
      modelName,
      mode: modelName === DEFAULT_PROFILE.modelName
        ? "collector-managed"
        : "mapped-user-model",
    }];
  }

  const profileIds = new Set(exportProfiles.map((profile) => profile.id));
  const fallbackProfileId = profileIds.has(String(raw.fallbackProfileId ?? ""))
    ? String(raw.fallbackProfileId)
    : exportProfiles[0]!.id;

  return {
    defaultLanguage: normalizeLanguage(String(raw.defaultLanguage ?? DEFAULT_SETTINGS.defaultLanguage)),
    sourceUrlMode: raw.sourceUrlMode === "query" || raw.sourceUrlMode === "none"
      ? raw.sourceUrlMode
      : "sanitized",
    exportProfiles,
    languageRoutes: normalizedRoutes(raw.languageRoutes, profileIds),
    fallbackProfileId,
  };
}

export async function loadSettings(): Promise<CollectorSettings> {
  const stored = await chrome.storage.local.get("collectorSettings");
  const settings = migrateSettings(stored.collectorSettings);

  // Persist the normalized profile-based schema so legacy deck/model settings are
  // deterministically migrated after the first ACCP-013 load.
  await chrome.storage.local.set({ collectorSettings: settings });
  return settings;
}

export async function saveSettings(settings: CollectorSettings): Promise<void> {
  const normalized = migrateSettings(settings);
  await chrome.storage.local.set({ collectorSettings: normalized });
}


export interface SettingsMergeResult {
  settings: CollectorSettings;
  conflicts: string[];
}

function sameProfile(left: ExportProfile, right: ExportProfile): boolean {
  return left.id === right.id
    && left.name === right.name
    && left.deckName === right.deckName
    && left.deckId === right.deckId
    && left.modelName === right.modelName
    && left.modelId === right.modelId
    && left.mode === right.mode;
}

function sameSettings(left: CollectorSettings, right: CollectorSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function mergeSettingsForRestore(
  currentValue: CollectorSettings,
  incomingValue: CollectorSettings,
): SettingsMergeResult {
  const current = migrateSettings(currentValue);
  const incoming = migrateSettings(incomingValue);

  if (sameSettings(current, DEFAULT_SETTINGS)) {
    return { settings: incoming, conflicts: [] };
  }

  const conflicts: string[] = [];
  const profiles = new Map(current.exportProfiles.map((profile) => [profile.id, profile]));

  for (const incomingProfile of incoming.exportProfiles) {
    const local = profiles.get(incomingProfile.id);
    if (!local) {
      profiles.set(incomingProfile.id, incomingProfile);
      continue;
    }
    if (!sameProfile(local, incomingProfile)) {
      conflicts.push(
        `Export profile conflict: "${incomingProfile.name}" uses profile id ${incomingProfile.id}, which already has different local configuration.`,
      );
    }
  }

  const routes = new Map(current.languageRoutes.map((route) => [route.language, route]));
  for (const incomingRoute of incoming.languageRoutes) {
    const local = routes.get(incomingRoute.language);
    if (!local) {
      routes.set(incomingRoute.language, incomingRoute);
      continue;
    }
    if (local.profileId !== incomingRoute.profileId) {
      conflicts.push(
        `Language route conflict: ${incomingRoute.language} already routes to a different local export profile.`,
      );
    }
  }

  return {
    settings: {
      ...current,
      exportProfiles: [...profiles.values()],
      languageRoutes: [...routes.values()].sort(
        (left, right) => left.language.localeCompare(right.language),
      ),
    },
    conflicts,
  };
}
