import type {
  CollectorSemanticField,
  ExportBinding,
  ExportFieldMapping,
  ExportProfile,
  LanguageRoute,
} from "../core/types";
import type { AnkiCatalogSnapshot, AnkiModelDetail } from "./catalog";
import {
  COLLECTOR_SEMANTIC_FIELDS,
  normalizeFieldMapping,
  validateFieldMapping,
  validateMappedTemplateCompatibility,
} from "./mapping";

export const COMMON_PROFILE_LANGUAGES = [
  { code: "he", label: "Hebrew" },
  { code: "sr", label: "Serbian" },
  { code: "es", label: "Spanish" },
  { code: "de", label: "German" },
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "tr", label: "Turkish" },
] as const;

export const GUIDED_PAYLOAD_SAMPLE: Record<CollectorSemanticField, string> = {
  Prompt: "Example prompt",
  Answer: "Example answer",
  Canonical: "canonical form",
  Observed: "observed form",
  Context: "Example sentence containing the study target.",
  Note: "Optional learner note",
  Source: "https://example.invalid/source",
  CardKind: "recognition",
  Why: "Representative learning-card rationale",
};

export function languageLabel(code: string): string {
  return COMMON_PROFILE_LANGUAGES.find((entry) => entry.code === code)?.label ?? code;
}

export function isGuidedLanguageCode(value: string): boolean {
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value.trim());
}

export function profileLanguageFromSavedState(
  profile: ExportProfile,
  routes: readonly LanguageRoute[],
): string | undefined {
  if (profile.language?.trim()) return profile.language.trim().toLowerCase();
  const matching = routes.filter((route) => route.profileId === profile.id);
  return matching.length === 1 ? matching[0]!.language.trim().toLowerCase() : undefined;
}

export interface PayloadPreviewRow {
  field: string;
  semantic?: CollectorSemanticField;
  value?: string;
  untouched: boolean;
}

export function buildMappedPayloadPreview(
  mappingValue: unknown,
  availableFields: readonly string[],
): PayloadPreviewRow[] {
  const mapping = normalizeFieldMapping(mappingValue);
  const ownerByField = new Map<string, CollectorSemanticField>();
  for (const semantic of COLLECTOR_SEMANTIC_FIELDS) {
    const target = mapping[semantic];
    if (target && !ownerByField.has(target)) ownerByField.set(target, semantic);
  }

  return availableFields.map((field) => {
    const semantic = ownerByField.get(field);
    return semantic
      ? { field, semantic, value: GUIDED_PAYLOAD_SAMPLE[semantic], untouched: false }
      : { field, untouched: true };
  });
}

export function validateMappedProfileAgainstLive(
  profile: ExportProfile,
  snapshot: AnkiCatalogSnapshot,
  detail: AnkiModelDetail,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (profile.mode !== "mapped-user-model") {
    errors.push("Guided live validation is only for mapped user-owned note types.");
    return { valid: false, errors };
  }

  const deck = snapshot.decks.find((candidate) => candidate.name === profile.deckName);
  if (!deck) {
    errors.push('Saved deck "' + profile.deckName + '" is missing from live Anki.');
  } else if (String(deck.id) !== profile.deckId) {
    errors.push('Saved deck "' + profile.deckName + '" has a different live ID. The same-name replacement is not trusted automatically.');
  }

  const model = snapshot.models.find((candidate) => candidate.name === profile.modelName);
  if (!model) {
    errors.push('Saved note type "' + profile.modelName + '" is missing from live Anki.');
  } else if (String(model.id) !== profile.modelId) {
    errors.push('Saved note type "' + profile.modelName + '" has a different live ID. The same-name replacement is not trusted automatically.');
  }

  if (detail.name !== profile.modelName) errors.push("Live note-type inspection does not match the saved model name.");
  if (detail.id !== undefined && String(detail.id) !== profile.modelId) {
    errors.push("Live note-type inspection does not match the saved model ID.");
  }

  const fieldValidation = validateFieldMapping(profile.fieldMapping, detail.fields);
  errors.push(...fieldValidation.errors);

  if (fieldValidation.valid) {
    const fieldsOnTemplates = Object.fromEntries(
      detail.templates.map((template) => [
        template.name,
        [[...template.frontFields], [...template.backFields]] as [string[], string[]],
      ]),
    );
    const templates = Object.fromEntries(
      detail.templates.map((template) => [
        template.name,
        { Front: template.front, Back: template.back },
      ]),
    );
    try {
      validateMappedTemplateCompatibility(profile, fieldsOnTemplates, templates);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Mapped note-type compatibility validation failed.");
    }
  }

  return { valid: errors.length === 0, errors };
}

function normalizedMappedIdentity(profile: ExportProfile): string {
  return JSON.stringify([
    profile.deckName,
    profile.deckId ?? "",
    profile.modelName,
    profile.modelId ?? "",
    profile.mode === "mapped-user-model"
      ? (profile.identityStrategy ?? "collector-tag")
      : (profile.identityStrategy ?? "collector-id-field"),
  ]);
}

function normalizedMapping(mapping: ExportFieldMapping | undefined): string {
  const normalized = normalizeFieldMapping(mapping);
  return JSON.stringify(
    COLLECTOR_SEMANTIC_FIELDS.map((semantic) => [semantic, normalized[semantic] ?? ""]),
  );
}

export function assessUsedMappedProfileEdit(
  original: ExportProfile,
  next: ExportProfile,
  bindings: readonly ExportBinding[],
): { durableBindingCount: number; identityChanged: boolean; fieldMappingChanged: boolean } {
  const durableBindingCount = bindings.filter(
    (binding) =>
      binding.profileId === original.id
      && (binding.state === "reserved" || binding.state === "exported" || binding.ankiNoteId !== undefined),
  ).length;

  return {
    durableBindingCount,
    identityChanged: normalizedMappedIdentity(original) !== normalizedMappedIdentity(next),
    fieldMappingChanged: normalizedMapping(original.fieldMapping) !== normalizedMapping(next.fieldMapping),
  };
}
