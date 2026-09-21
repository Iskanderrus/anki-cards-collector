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
    && Boolean(profile.deckId?.trim())
    && Boolean(profile.modelId?.trim())
    && validateFieldMapping(profile.fieldMapping).valid;
}

export function validateMappedProfile(
  profile: ExportProfile,
  availableFields?: readonly string[],
): ExportFieldMapping {
  if (profile.mode !== "mapped-user-model") {
    throw new Error("This export profile is not a mapped user-owned note type.");
  }
  if (!profile.deckId?.trim() || !profile.modelId?.trim()) {
    throw new Error(
      "Mapped user-owned export requires confirmed live Anki deck and note-type IDs. Refresh and re-confirm this profile before writing.",
    );
  }

  const result = validateFieldMapping(profile.fieldMapping, availableFields);
  if (!result.valid) {
    throw new Error(result.errors.join(" "));
  }
  return result.normalized;
}

function exactStringHex(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return encoded;
}

export function collectorIdentityTag(lexicalUnitId: string): string {
  if (!lexicalUnitId) throw new Error("Collector lexical-unit identity cannot be empty.");
  return `collector::id::${exactStringHex(lexicalUnitId)}`;
}

export function collectorIdentityQuery(lexicalUnitId: string): string {
  // Hex-only identity plus regex anchors avoids Anki wildcard and subtag matching.
  return "tag:re:^" + collectorIdentityTag(lexicalUnitId) + "$";
}

export interface MappedTemplateHtml {
  Front: string;
  Back: string;
}

export function validateMappedQuestionFields(
  profile: ExportProfile,
  fieldsOnTemplates: Record<string, [string[], string[]]>,
): void {
  const mapping = validateMappedProfile(profile);
  const promptField = mapping.Prompt;
  if (!promptField) {
    throw new Error("Map Collector Prompt to an existing Anki field.");
  }

  const questionFields = new Set<string>();
  for (const [templateName, sides] of Object.entries(fieldsOnTemplates)) {
    if (
      !Array.isArray(sides)
      || sides.length !== 2
      || !Array.isArray(sides[0])
      || sides[0].some((field) => typeof field !== "string")
    ) {
      throw new Error(
        `Anki template "${templateName}" returned invalid question-side field metadata.`,
      );
    }
    for (const field of sides[0]) questionFields.add(field);
  }

  if (!questionFields.has(promptField)) {
    throw new Error(
      `Mapped Prompt field "${promptField}" is not used on the question side of any card template.`,
    );
  }
}

export function validateMappedTemplates(
  profile: ExportProfile,
  templates: Record<string, MappedTemplateHtml>,
): void {
  const usesCloze = Object.values(templates).some(
    (template) => /\{\{\s*cloze\s*:/i.test(`${template.Front}\n${template.Back}`),
  );
  if (usesCloze) {
    throw new Error(
      `Anki note type "${profile.modelName}" uses cloze templates. Mapped cloze export is not supported yet; choose a non-cloze note type.`,
    );
  }
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
