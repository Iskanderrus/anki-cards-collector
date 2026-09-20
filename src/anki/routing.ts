import type {
  CollectedItem,
  CollectorSettings,
  ExportBinding,
  ExportProfile,
} from "../core/types";

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
    const profile = profileById(settings, binding.profileId);
    if (!profile) {
      throw new Error(
        `Export destination for "${item.lexicalUnit.canonicalText}" is pinned to a missing profile. Reassign it explicitly before export.`,
      );
    }
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

export function validateProfileForCurrentExport(profile: ExportProfile): void {
  if (profile.mode !== "collector-managed") {
    throw new Error(
      `Export profile "${profile.name}" uses an existing user-owned note type. Field mapping is implemented by ACCP-014; this profile cannot export yet.`,
    );
  }
}
