import type {
  CollectedItem,
  CollectorSettings,
  ExportBinding,
  ExportProfile,
} from "../core/types";
import { COLLECTOR_MANAGED_MODEL_NAME } from "../settings";
import { validateMappedProfile } from "./mapping";

export interface ResolvedExportRoute {
  profile: ExportProfile;
  source: "binding" | "language" | "fallback";
  binding: ExportBinding | null;
}

function normalizeLanguage(language: string): string {
  return language.trim().toLowerCase() || "und";
}

export function profileById(
  settings: CollectorSettings,
  profileId: string,
): ExportProfile | null {
  return settings.exportProfiles.find((profile) => profile.id === profileId) ?? null;
}

export function resolveExportRoute(
  item: CollectedItem,
  settings: CollectorSettings,
  binding: ExportBinding | null,
): ResolvedExportRoute {
  if (binding) {
    const configuredProfile = profileById(settings, binding.profileId);
    if (!configuredProfile) {
      throw new Error(
        `Export destination for "${item.lexicalUnit.canonicalText}" is pinned to a missing profile. Reassign it explicitly before export.`,
      );
    }

    const profile = {
      ...configuredProfile,
      deckName: binding.deckName ?? configuredProfile.deckName,
      modelName: binding.modelName ?? configuredProfile.modelName,
    };

    return { profile, source: "binding", binding };
  }

  const language = normalizeLanguage(item.lexicalUnit.language);
  const route = settings.languageRoutes.find(
    (candidate) => normalizeLanguage(candidate.language) === language,
  );
  if (route) {
    const profile = profileById(settings, route.profileId);
    if (!profile) {
      throw new Error(`Language route ${language} points to a missing export profile.`);
    }
    return { profile, source: "language", binding: null };
  }

  const fallback = profileById(settings, settings.fallbackProfileId);
  if (!fallback) {
    throw new Error("No valid fallback export profile is configured.");
  }
  return { profile: fallback, source: "fallback", binding: null };
}

export function assertDestinationChangeReconciled(
  binding: ExportBinding | null | undefined,
): void {
  if (binding?.state === "reserved") {
    throw new Error(
      "A previous Anki export may already have reached this card. Retry export before changing its destination.",
    );
  }
}

export function validateProfileForCurrentExport(profile: ExportProfile): void {
  if (profile.mode === "collector-managed") {
    if (profile.modelName !== COLLECTOR_MANAGED_MODEL_NAME) {
      throw new Error(
        `Collector-managed export is only supported for "${COLLECTOR_MANAGED_MODEL_NAME}".`,
      );
    }
    return;
  }

  if (profile.mode === "mapped-user-model") {
    validateMappedProfile(profile);
    return;
  }

  throw new Error("This Anki destination has an unsupported ownership mode.");
}
