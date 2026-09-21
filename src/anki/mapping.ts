import type {
  CollectedItem,
  CollectorSemanticField,
  ExportFieldMapping,
  ExportProfile,
} from "../core/types";
import { proposeLearningCard } from "../learning/policy";

export const COLLECTOR_SEMANTIC_FIELDS: readonly CollectorSemanticField[] = [
  "Prompt",
  "Answer",
  "Canonical",
  "Observed",
  "Context",
  "Note",
  "Source",
  "CardKind",
  "Why",
];

export const REQUIRED_MAPPED_SEMANTIC_FIELDS: readonly CollectorSemanticField[] = [
  "Prompt",
  "Answer",
];

export interface FieldMappingValidation {
  valid: boolean;
  errors: string[];
  normalized: ExportFieldMapping;
}

function normalizedTarget(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeFieldMapping(value: unknown): ExportFieldMapping {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const record = value as Record<string, unknown>;
  const normalized: ExportFieldMapping = {};

  for (const semantic of COLLECTOR_SEMANTIC_FIELDS) {
    const target = normalizedTarget(record[semantic]);
    if (target) normalized[semantic] = target;
  }

  return normalized;
}

export function validateFieldMapping(
  mappingValue: unknown,
  availableFields?: readonly string[],
): FieldMappingValidation {
  const normalized = normalizeFieldMapping(mappingValue);
  const errors: string[] = [];

  for (const semantic of REQUIRED_MAPPED_SEMANTIC_FIELDS) {
    if (!normalized[semantic]) {
      errors.push(`Map Collector ${semantic} to an existing Anki field.`);
    }
  }

  const owners = new Map<string, CollectorSemanticField>();
  for (const semantic of COLLECTOR_SEMANTIC_FIELDS) {
    const target = normalized[semantic];
    if (!target) continue;

    const existing = owners.get(target);
    if (existing) {
      errors.push(
        `Anki field "${target}" is mapped from both ${existing} and ${semantic}; use a distinct destination field for each semantic value.`,
      );
    } else {
      owners.set(target, semantic);
    }

    if (availableFields && !availableFields.includes(target)) {
      errors.push(
        `Mapped Anki field "${target}" for ${semantic} does not exist on the selected note type.`,
      );
    }
  }

  return { valid: errors.length === 0, errors, normalized };
}

export function mappedProfileIsConfigured(profile: ExportProfile): boolean {
  return profile.mode === "mapped-user-model"
    && validateFieldMapping(profile.fieldMapping).valid;
}

export function validateMappedProfile(
  profile: ExportProfile,
  availableFields?: readonly string[],
): ExportFieldMapping {
  if (profile.mode !== "mapped-user-model") {
    throw new Error("This export profile is not a mapped user-owned note type.");
  }

  const result = validateFieldMapping(profile.fieldMapping, availableFields);
  if (!result.valid) {
    throw new Error(result.errors.join(" "));
  }
  return result.normalized;
}

export function collectorIdentityTag(lexicalUnitId: string): string {
  return `collector::id::${lexicalUnitId}`;
}

export function mappedSemanticValues(
  item: CollectedItem,
): Record<CollectorSemanticField, string> {
  const proposal = proposeLearningCard(item);
  if (!proposal.recommended) {
    throw new Error(proposal.warning ?? "This item needs review before export.");
  }

  const occurrence = proposal.occurrenceSelection?.occurrence;
  return {
    Prompt: proposal.prompt,
    Answer: proposal.answer,
    Canonical: item.lexicalUnit.canonicalText,
    Observed: occurrence?.surfaceText ?? item.lexicalUnit.canonicalText,
    Context: occurrence?.context ?? "",
    Note: item.lexicalUnit.note,
    Source: occurrence?.source.url ?? "",
    CardKind: proposal.cardKind,
    Why: proposal.reason,
  };
}

export function mappedAnkiFields(
  item: CollectedItem,
  profile: ExportProfile,
): Record<string, string> {
  const mapping = validateMappedProfile(profile);
  const values = mappedSemanticValues(item);
  const fields: Record<string, string> = {};

  for (const semantic of COLLECTOR_SEMANTIC_FIELDS) {
    const target = mapping[semantic];
    if (target) fields[target] = values[semantic];
  }

  return fields;
}
