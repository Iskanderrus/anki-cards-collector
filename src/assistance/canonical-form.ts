import { normalizeIdentityText, normalizeLanguage, normalizeText } from "../core/normalize";

import type { CanonicalizationPreview, CaptureRepository } from "../storage/repository";

export type CanonicalFormConfidence = "high" | "possible" | "ambiguous";

export interface CanonicalFormSuggestion {
  proposedCanonical: string;
  language: string;
  confidence?: CanonicalFormConfidence;
  category?: string;
  evidenceLabel?: string;
}

export interface CanonicalFormProviderInput {
  language: string;
  observedForm: string;
  currentCanonical?: string;
  context?: string;
}

export type CanonicalFormProviderResult =
  | { kind: "none" }
  | { kind: "suggestions"; suggestions: CanonicalFormSuggestion[] };

export interface CanonicalFormProvider {
  supports(language: string): boolean;
  suggest(input: CanonicalFormProviderInput): Promise<CanonicalFormProviderResult>;
}

export interface CanonicalFormAssistanceInput {
  lexicalUnitId: string;
  lexicalUnitUpdatedAt: string;
  language: string;
  observedForm: string;
  currentCanonical: string;
  context?: string;
  occurrenceId?: string;
}

export interface CanonicalFormRequestSnapshot {
  lexicalUnitId: string;
  lexicalUnitUpdatedAt: string;
  language: string;
  observedForm: string;
  currentCanonical: string;
  occurrenceId?: string;
  context?: string;
}

export type CanonicalFormAssistanceResult =
  | {
      kind: "unsupported";
      language: string;
      snapshot: CanonicalFormRequestSnapshot;
    }
  | {
      kind: "none";
      snapshot: CanonicalFormRequestSnapshot;
    }
  | {
      kind: "suggestion";
      snapshot: CanonicalFormRequestSnapshot;
      suggestion: CanonicalFormSuggestion;
    }
  | {
      kind: "ambiguous";
      snapshot: CanonicalFormRequestSnapshot;
      suggestions: CanonicalFormSuggestion[];
    }
  | {
      kind: "unavailable";
      reason: "provider-error" | "malformed-result";
      snapshot: CanonicalFormRequestSnapshot;
    };

export interface AcceptedCanonicalFormSuggestion {
  item: Awaited<ReturnType<CaptureRepository["update"]>>;
  preview: CanonicalizationPreview;
}

const MAX_PROVIDER_CONTEXT_CHARS = 320;

function requestSnapshot(input: CanonicalFormAssistanceInput): CanonicalFormRequestSnapshot {
  const language = normalizeLanguage(input.language);
  const context = input.context === undefined
    ? undefined
    : normalizeText(input.context).slice(0, MAX_PROVIDER_CONTEXT_CHARS);
  return {
    lexicalUnitId: input.lexicalUnitId,
    lexicalUnitUpdatedAt: input.lexicalUnitUpdatedAt,
    language,
    observedForm: normalizeText(input.observedForm),
    currentCanonical: normalizeText(input.currentCanonical),
    ...(input.occurrenceId ? { occurrenceId: input.occurrenceId } : {}),
    ...(context ? { context } : {}),
  };
}

function providerInput(
  _input: CanonicalFormAssistanceInput,
  snapshot: CanonicalFormRequestSnapshot,
): CanonicalFormProviderInput {
  return {
    language: snapshot.language,
    observedForm: snapshot.observedForm,
    currentCanonical: snapshot.currentCanonical,
    ...(snapshot.context ? { context: snapshot.context } : {}),
  };
}

function sanitizeSuggestions(
  value: CanonicalFormProviderResult,
  expectedLanguage: string,
  currentCanonical: string,
): CanonicalFormSuggestion[] | null {
  if (!value || typeof value !== "object") return null;
  if (value.kind === "none") return [];
  if (value.kind !== "suggestions" || !Array.isArray(value.suggestions)) return null;

  const sanitized: CanonicalFormSuggestion[] = [];
  for (const candidate of value.suggestions) {
    if (!candidate || typeof candidate !== "object") return null;
    if (typeof candidate.proposedCanonical !== "string") return null;
    if (typeof candidate.language !== "string") return null;

    const proposedCanonical = normalizeText(candidate.proposedCanonical);
    const language = normalizeLanguage(candidate.language);
    if (!proposedCanonical || language !== expectedLanguage) return null;

    if (
      candidate.confidence !== undefined
      && !["high", "possible", "ambiguous"].includes(candidate.confidence)
    ) return null;
    if (candidate.category !== undefined && typeof candidate.category !== "string") return null;
    if (candidate.evidenceLabel !== undefined && typeof candidate.evidenceLabel !== "string") {
      return null;
    }

    if (normalizeIdentityText(proposedCanonical) === normalizeIdentityText(currentCanonical)) {
      continue;
    }

    sanitized.push({
      proposedCanonical,
      language,
      ...(candidate.confidence ? { confidence: candidate.confidence } : {}),
      ...(candidate.category ? { category: candidate.category.trim().slice(0, 80) } : {}),
      ...(candidate.evidenceLabel
        ? { evidenceLabel: candidate.evidenceLabel.trim().slice(0, 160) }
        : {}),
    });
  }

  const unique = new Map<string, CanonicalFormSuggestion>();
  for (const candidate of sanitized) {
    const key = `${candidate.language}\u0000${normalizeIdentityText(candidate.proposedCanonical)}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()];
}

export async function requestCanonicalFormAssistance(
  provider: CanonicalFormProvider,
  input: CanonicalFormAssistanceInput,
): Promise<CanonicalFormAssistanceResult> {
  const snapshot = requestSnapshot(input);

  let supported: boolean;
  try {
    supported = provider.supports(snapshot.language);
  } catch {
    return { kind: "unavailable", reason: "provider-error", snapshot };
  }
  if (!supported) {
    return { kind: "unsupported", language: snapshot.language, snapshot };
  }

  let raw: CanonicalFormProviderResult;
  try {
    raw = await provider.suggest(providerInput(input, snapshot));
  } catch {
    return { kind: "unavailable", reason: "provider-error", snapshot };
  }

  const suggestions = sanitizeSuggestions(
    raw,
    snapshot.language,
    snapshot.currentCanonical,
  );
  if (suggestions === null) {
    return { kind: "unavailable", reason: "malformed-result", snapshot };
  }
  if (suggestions.length === 0) return { kind: "none", snapshot };
  if (suggestions.length === 1) {
    return { kind: "suggestion", snapshot, suggestion: suggestions[0]! };
  }
  return { kind: "ambiguous", snapshot, suggestions };
}

const SPANISH_IRREGULAR_FORMS: Readonly<Record<string, readonly string[]>> = {
  tengo: ["tener"],
  estoy: ["estar"],
  soy: ["ser"],
  voy: ["ir"],
  fui: ["ir", "ser"],
  hago: ["hacer"],
  digo: ["decir"],
  vengo: ["venir"],
  pongo: ["poner"],
  salgo: ["salir"],
  puedo: ["poder"],
  quiero: ["querer"],
};

export const localCanonicalFormProvider: CanonicalFormProvider = {
  supports(language: string): boolean {
    return normalizeLanguage(language) === "es";
  },

  async suggest(input: CanonicalFormProviderInput): Promise<CanonicalFormProviderResult> {
    const language = normalizeLanguage(input.language);
    const observed = normalizeIdentityText(input.observedForm);
    const candidates = SPANISH_IRREGULAR_FORMS[observed];
    if (language !== "es" || !candidates) return { kind: "none" };

    const ambiguous = candidates.length > 1;
    return {
      kind: "suggestions",
      suggestions: candidates.map((proposedCanonical) => ({
        proposedCanonical,
        language,
        confidence: ambiguous ? "ambiguous" : "high",
        category: ambiguous
          ? "ambiguous-irregular-inflection"
          : "explicit-irregular-inflection",
        evidenceLabel: ambiguous
          ? "Known irregular form with more than one possible infinitive."
          : "Known irregular inflected form from the local conservative lexicon.",
      })),
    };
  },
};

function e2eSuggestion(
  proposedCanonical: string,
  language = "es",
): CanonicalFormProviderResult {
  return {
    kind: "suggestions",
    suggestions: [{
      proposedCanonical,
      language,
      confidence: "high",
      category: "e2e-fixture",
      evidenceLabel: "Deterministic browser-test fixture.",
    }],
  };
}

class E2eCanonicalFormProvider implements CanonicalFormProvider {
  private supersedeRequests = 0;

  supports(language: string): boolean {
    return localCanonicalFormProvider.supports(language);
  }

  async suggest(input: CanonicalFormProviderInput): Promise<CanonicalFormProviderResult> {
    const observed = normalizeIdentityText(input.observedForm);

    if (observed === "providerunavailable") {
      throw new Error("Synthetic provider failure.");
    }

    if (observed === "delayform") {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 350));
      return e2eSuggestion("delaylemma");
    }

    if (observed === "supersedeform") {
      this.supersedeRequests += 1;
      const first = this.supersedeRequests === 1;
      await new Promise((resolve) => globalThis.setTimeout(resolve, first ? 1200 : 25));
      return e2eSuggestion(first ? "oldlemma" : "newlemma");
    }

    return localCanonicalFormProvider.suggest(input);
  }
}

export function createCanonicalFormProvider(e2eMode = false): CanonicalFormProvider {
  return e2eMode ? new E2eCanonicalFormProvider() : localCanonicalFormProvider;
}

export class CanonicalFormRequestGate {
  private sequence = 0;
  private activeLexicalUnitId: string | null = null;

  start(lexicalUnitId: string): number {
    this.sequence += 1;
    this.activeLexicalUnitId = lexicalUnitId;
    return this.sequence;
  }

  invalidate(): void {
    this.sequence += 1;
    this.activeLexicalUnitId = null;
  }

  isCurrent(requestId: number, lexicalUnitId: string): boolean {
    return requestId === this.sequence && lexicalUnitId === this.activeLexicalUnitId;
  }
}

function sameCanonicalState(
  currentCanonical: string,
  currentLanguage: string,
  snapshot: CanonicalFormRequestSnapshot,
): boolean {
  return (
    normalizeIdentityText(currentCanonical) === normalizeIdentityText(snapshot.currentCanonical)
    && normalizeLanguage(currentLanguage) === snapshot.language
  );
}

export async function acceptCanonicalFormSuggestion(
  repository: CaptureRepository,
  result: Extract<
    CanonicalFormAssistanceResult,
    { kind: "suggestion" | "ambiguous" }
  >,
  suggestion: CanonicalFormSuggestion,
): Promise<AcceptedCanonicalFormSuggestion> {
  const snapshot = result.snapshot;
  const current = (await repository.list()).find(
    (item) => item.lexicalUnit.id === snapshot.lexicalUnitId,
  );
  const currentOccurrence = snapshot.occurrenceId
    ? current?.occurrences.find((occurrence) => occurrence.id === snapshot.occurrenceId)
    : undefined;
  const occurrenceChanged = snapshot.occurrenceId !== undefined && (
    !currentOccurrence
    || normalizeText(currentOccurrence.surfaceText) !== snapshot.observedForm
    || normalizeText(currentOccurrence.context).slice(0, MAX_PROVIDER_CONTEXT_CHARS)
      !== (snapshot.context ?? "")
  );
  if (
    !current
    || current.lexicalUnit.updatedAt !== snapshot.lexicalUnitUpdatedAt
    || occurrenceChanged
    || !sameCanonicalState(
      current.lexicalUnit.canonicalText,
      current.lexicalUnit.language,
      snapshot,
    )
  ) {
    throw new Error(
      "This canonical-form suggestion is stale because the lexical unit changed. Request a fresh suggestion.",
    );
  }

  const canonical = normalizeText(suggestion.proposedCanonical);
  const language = normalizeLanguage(suggestion.language);
  const offeredSuggestions = result.kind === "suggestion"
    ? [result.suggestion]
    : result.suggestions;
  const wasOffered = offeredSuggestions.some((candidate) => (
    normalizeLanguage(candidate.language) === language
    && normalizeIdentityText(candidate.proposedCanonical) === normalizeIdentityText(canonical)
  ));
  if (!canonical || language !== snapshot.language || !wasOffered) {
    throw new Error("This canonical-form suggestion is no longer valid.");
  }

  const preview = await repository.previewCanonicalization(
    snapshot.lexicalUnitId,
    canonical,
    language,
  );
  const item = await repository.update(snapshot.lexicalUnitId, {
    canonicalText: canonical,
    language,
    note: current.lexicalUnit.note,
    expectedUpdatedAt: snapshot.lexicalUnitUpdatedAt,
  });

  return { item, preview };
}
