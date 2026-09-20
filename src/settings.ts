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

export const COLLECTOR_MANAGED_MODEL_NAME = "Collector Basic";

const DEFAULT_PROFILE: ExportProfile = {
  id: LEGACY_DEFAULT_PROFILE_ID,
  name: "Collector default",
  deckName: "Collector Inbox",
  modelName: COLLECTOR_MANAGED_MODEL_NAME,
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

export function managedProfileIdForDeck(deckName: string): string {
  return `collector-deck:${encodeURIComponent(deckName.trim() || "Collector Inbox")}`;
}

function managedProfileForDeck(
  deckName: string,
  deckId?: string,
): ExportProfile {
  const normalizedDeck = deckName.trim() || "Collector Inbox";
  return {
    id: managedProfileIdForDeck(normalizedDeck),
    name: normalizedDeck,
    deckName: normalizedDeck,
    ...(deckId ? { deckId } : {}),
    modelName: COLLECTOR_MANAGED_MODEL_NAME,
    mode: "collector-managed",
  };
}

export function ensureManagedProfileForDeck(
  settings: CollectorSettings,
  deckName: string,
  deckId?: string,
): { settings: CollectorSettings; profile: ExportProfile } {
  const normalizedDeck = deckName.trim() || "Collector Inbox";
  const existing = settings.exportProfiles.find(
    (profile) =>
      profile.mode === "collector-managed"
      && profile.modelName === COLLECTOR_MANAGED_MODEL_NAME
      && profile.deckName === normalizedDeck,
  );

  if (existing) {
    const profile = deckId && existing.deckId !== deckId
      ? { ...existing, deckId }
      : existing;
    const exportProfiles = profile === existing
      ? settings.exportProfiles
      : settings.exportProfiles.map((candidate) =>
          candidate.id === existing.id ? profile : candidate
        );
    return {
      settings: exportProfiles === settings.exportProfiles
        ? settings
        : { ...settings, exportProfiles },
      profile,
    };
  }

  const profile = managedProfileForDeck(normalizedDeck, deckId);
  return {
    settings: {
      ...settings,
      exportProfiles: [...settings.exportProfiles, profile],
    },
    profile,
  };
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
    if (!id || !name || !deckName || !modelName || ids.has(id)) continue;

    if (profile.mode !== "collector-managed" && profile.mode !== "mapped-user-model") {
      throw new Error(
        `Export destination "${name || id}" has an unsupported ownership mode.`,
      );
    }

    ids.add(id);
    profiles.push({
      id,
      name,
      deckName,
      ...(profile.deckId ? { deckId: String(profile.deckId) } : {}),
      modelName,
      ...(profile.modelId ? { modelId: String(profile.modelId) } : {}),
      mode: profile.mode,
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

function repairManagedRouting(settings: CollectorSettings): CollectorSettings {
  let repaired = {
    ...settings,
    exportProfiles: [...settings.exportProfiles],
    languageRoutes: [...settings.languageRoutes],
  };

  const profile = (profileId: string) =>
    repaired.exportProfiles.find((candidate) => candidate.id === profileId);

  const ensureFor = (source: ExportProfile): ExportProfile => {
    const ensured = ensureManagedProfileForDeck(repaired, source.deckName, source.deckId);
    repaired = ensured.settings;
    return ensured.profile;
  };

  const fallback = profile(repaired.fallbackProfileId);
  if (!fallback || fallback.mode !== "collector-managed") {
    const source = fallback ?? repaired.exportProfiles[0] ?? DEFAULT_PROFILE;
    const managedFallback = ensureFor(source);
    repaired = {
      ...repaired,
      fallbackProfileId: managedFallback.id,
    };
  }

  repaired.languageRoutes = repaired.languageRoutes.map((route) => {
    const source = profile(route.profileId);
    if (!source || source.mode === "collector-managed") return route;
    return {
      language: route.language,
      profileId: ensureFor(source).id,
    };
  });

  return repaired;
}

export function migrateSettings(value: unknown): CollectorSettings {
  const raw = value && typeof value === "object"
    ? value as Partial<CollectorSettings> & LegacyCollectorSettings
    : {};

  let exportProfiles = normalizedProfiles(raw.exportProfiles);

  if (exportProfiles.length === 0) {
    const deckName = String(raw.deckName ?? DEFAULT_PROFILE.deckName).trim() || DEFAULT_PROFILE.deckName;
    const modelName = String(raw.modelName ?? DEFAULT_PROFILE.modelName).trim() || DEFAULT_PROFILE.modelName;

    if (modelName === COLLECTOR_MANAGED_MODEL_NAME) {
      exportProfiles = [{ ...DEFAULT_PROFILE, deckName }];
    } else {
      // Preserve the old user-owned destination for already-exported bindings,
      // but never make it the destination for new/unbound cards.
      exportProfiles = [{
        ...DEFAULT_PROFILE,
        name: "Legacy Anki destination",
        deckName,
        modelName,
        mode: "mapped-user-model",
      }];
    }
  }

  const profileIds = new Set(exportProfiles.map((profile) => profile.id));
  const requestedFallback = profileIds.has(String(raw.fallbackProfileId ?? ""))
    ? String(raw.fallbackProfileId)
    : exportProfiles[0]!.id;

  const migrated: CollectorSettings = {
    defaultLanguage: normalizeLanguage(String(raw.defaultLanguage ?? DEFAULT_SETTINGS.defaultLanguage)),
    sourceUrlMode: raw.sourceUrlMode === "query" || raw.sourceUrlMode === "none"
      ? raw.sourceUrlMode
      : "sanitized",
    exportProfiles,
    languageRoutes: normalizedRoutes(raw.languageRoutes, profileIds),
    fallbackProfileId: requestedFallback,
  };

  return repairManagedRouting(migrated);
}

export async function loadSettings(): Promise<CollectorSettings> {
  const stored = await chrome.storage.local.get("collectorSettings");
  const settings = migrateSettings(stored.collectorSettings);
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
  hasLocalCorpusState = false,
): SettingsMergeResult {
  const current = migrateSettings(currentValue);
  const incoming = migrateSettings(incomingValue);

  if (!hasLocalCorpusState && sameSettings(current, DEFAULT_SETTINGS)) {
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
        `Export destination conflict: "${incomingProfile.deckName}" already has different local configuration.`,
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
        `Language route conflict: ${incomingRoute.language} already uses a different Anki deck.`,
      );
    }
  }

  return {
    settings: migrateSettings({
      ...current,
      exportProfiles: [...profiles.values()],
      languageRoutes: [...routes.values()].sort(
        (left, right) => left.language.localeCompare(right.language),
      ),
    }),
    conflicts,
  };
}
