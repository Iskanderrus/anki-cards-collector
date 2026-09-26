import type {
  CollectedItem,
  CollectorSemanticField,
  Occurrence,
} from "../core/types";
import { normalizeIdentityText } from "../core/normalize";
import {
  buildContextualPrompt,
  selectBestOccurrence,
  type OccurrenceSelection,
} from "./occurrence-selection";

export type LearningUnitKind = "word" | "chunk" | "sentence";
export type LearningCardKind =
  | "context-recognition"
  | "context-production"
  | "context-recall"
  | "sentence-review";

export type LearningDecisionCode =
  | "word-note-recognition"
  | "word-context-recognition"
  | "chunk-context-production"
  | "chunk-note-recognition"
  | "sentence-context-recall"
  | "sentence-note-review"
  | "reject-too-broad"
  | "reject-word-evidence"
  | "reject-chunk-context"
  | "reject-sentence-target";

export type LearningWarningCode =
  | "too-broad"
  | "add-word-evidence"
  | "improve-chunk-context"
  | "narrow-sentence-target";

export interface LearningCardProposal {
  unitKind: LearningUnitKind;
  cardKind: LearningCardKind;
  prompt: string;
  answer: string;
  reasonCode: LearningDecisionCode;
  reason: string;
  recommended: boolean;
  warningCode?: LearningWarningCode;
  warning?: string;
  occurrenceSelection?: OccurrenceSelection;
}

export interface DerivedLearningStudyContent {
  proposal: LearningCardProposal;
  selectedOccurrence?: Occurrence;
  semanticValues: Record<CollectorSemanticField, string>;
}

const MAX_CAPTURE_WORDS = 25;
const MAX_CAPTURE_CHARS = 180;
const MAX_CHUNK_WORDS = 7;
const MAX_SENTENCE_RECALL_WORDS = 12;
const MIN_RESIDUAL_CONTEXT_WORDS = 4;

export function wordTokens(text: string): string[] {
  return text.match(/[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu) ?? [];
}

export function classifyLearningUnit(text: string): LearningUnitKind {
  const count = wordTokens(text).length;
  if (count <= 1) return "word";
  if (count <= MAX_CHUNK_WORDS) return "chunk";
  return "sentence";
}

function canonicalSuffix(surfaceText: string, canonicalText: string): string {
  return normalizeIdentityText(surfaceText) === normalizeIdentityText(canonicalText)
    ? ""
    : `Canonical: ${canonicalText}`;
}

function recognitionAnswer(
  surfaceText: string,
  canonicalText: string,
  note: string,
  context: string,
): string {
  return [
    note.trim(),
    canonicalSuffix(surfaceText, canonicalText),
    context ? `Context: ${context}` : "",
  ].filter(Boolean).join("\n\n");
}

function productionAnswer(surfaceText: string, canonicalText: string, note: string): string {
  return [
    surfaceText,
    canonicalSuffix(surfaceText, canonicalText),
    note.trim(),
  ].filter(Boolean).join("\n\n");
}

function usefulRecognitionContext(selection: OccurrenceSelection | null): boolean {
  const breakdown = selection?.breakdown;
  return Boolean(
    breakdown
    && breakdown.targetInContext
    && breakdown.residualWords >= 2
    && breakdown.contextWords <= 80
    && breakdown.noisePenalty >= 0,
  );
}

function strongProductionContext(
  selection: OccurrenceSelection | null,
  cloze: string | null,
): boolean {
  const breakdown = selection?.breakdown;
  return Boolean(
    cloze
    && breakdown
    && breakdown.targetInContext
    && breakdown.clozeUsability > 0
    && breakdown.residualWords >= MIN_RESIDUAL_CONTEXT_WORDS
    && breakdown.contextWords <= 80
    && breakdown.noisePenalty >= 0,
  );
}

function boundedSentenceRecall(
  selection: OccurrenceSelection | null,
  cloze: string | null,
  tokenCount: number,
): boolean {
  const breakdown = selection?.breakdown;
  return Boolean(
    cloze
    && breakdown
    && tokenCount <= MAX_SENTENCE_RECALL_WORDS
    && breakdown.targetInContext
    && breakdown.beforeWords > 0
    && breakdown.afterWords > 0
    && breakdown.residualWords >= MIN_RESIDUAL_CONTEXT_WORDS
    && breakdown.contextWords <= 80
    && breakdown.noisePenalty >= 0,
  );
}

export function proposeLearningCard(item: CollectedItem): LearningCardProposal {
  const canonicalText = item.lexicalUnit.canonicalText.trim();
  const note = item.lexicalUnit.note.trim();
  const unitKind = classifyLearningUnit(canonicalText);
  const occurrenceSelection = selectBestOccurrence(item.occurrences, {
    preferContextualCloze: unitKind !== "word",
    minResidualContextWords: MIN_RESIDUAL_CONTEXT_WORDS,
  });
  const occurrence = occurrenceSelection?.occurrence;
  const surfaceText = occurrence?.surfaceText.trim() || canonicalText;
  const context = occurrence?.context.trim() ?? "";
  const tokenCount = wordTokens(canonicalText).length;
  const selection = occurrenceSelection ? { occurrenceSelection } : {};

  if (tokenCount > MAX_CAPTURE_WORDS || canonicalText.length > MAX_CAPTURE_CHARS) {
    return {
      ...selection,
      unitKind,
      cardKind: "sentence-review",
      prompt: canonicalText,
      answer: note,
      reasonCode: "reject-too-broad",
      reason: `The canonical target is too broad for one bounded retrieval task.`,
      recommended: false,
      warningCode: "too-broad",
      warning: "Shorten the canonical form or isolate the part you actually want to retrieve before marking it ready.",
    };
  }

  const cloze = buildContextualPrompt(
    context,
    surfaceText,
    MIN_RESIDUAL_CONTEXT_WORDS,
  );

  if (unitKind === "word") {
    if (note) {
      return {
        ...selection,
        unitKind,
        cardKind: "context-recognition",
        prompt: surfaceText,
        answer: recognitionAnswer(surfaceText, canonicalText, note, context),
        reasonCode: "word-note-recognition",
        reason: `A single lexical item uses recognition, and the learner note supplies the explicit answer without generated semantics.`,
        recommended: true,
      };
    }

    if (usefulRecognitionContext(occurrenceSelection)) {
      return {
        ...selection,
        unitKind,
        cardKind: "context-recognition",
        prompt: surfaceText,
        answer: recognitionAnswer(surfaceText, canonicalText, "", context),
        reasonCode: "word-context-recognition",
        reason: `A single lexical item stays a recognition card. The selected context is shown only as observed evidence, not as an invented meaning.`,
        recommended: true,
      };
    }

    return {
      ...selection,
      unitKind,
      cardKind: "context-recognition",
      prompt: surfaceText,
      answer: recognitionAnswer(surfaceText, canonicalText, "", context),
      reasonCode: "reject-word-evidence",
      reason: `The selected evidence is too weak or noisy to make a useful recognition card without pretending context is a meaning.`,
      recommended: false,
      warningCode: "add-word-evidence",
      warning: "Add a learner note or capture this word in a clearer context before marking it ready.",
    };
  }

  if (unitKind === "chunk") {
    if (strongProductionContext(occurrenceSelection, cloze)) {
      return {
        ...selection,
        unitKind,
        cardKind: "context-production",
        prompt: cloze!,
        answer: productionAnswer(surfaceText, canonicalText, note),
        reasonCode: "chunk-context-production",
        reason: `The selected observed chunk has a strong contextual occurrence, so the observed surface form is the bounded production target.`,
        recommended: true,
      };
    }

    if (note) {
      return {
        ...selection,
        unitKind,
        cardKind: "context-recognition",
        prompt: surfaceText,
        answer: recognitionAnswer(surfaceText, canonicalText, note, context),
        reasonCode: "chunk-note-recognition",
        reason: `The selected context is not strong enough for production, so the explicit learner note supports a safer recognition card.`,
        recommended: true,
      };
    }

    return {
      ...selection,
      unitKind,
      cardKind: "context-recognition",
      prompt: surfaceText,
      answer: recognitionAnswer(surfaceText, canonicalText, "", context),
      reasonCode: "reject-chunk-context",
      reason: `This chunk does not have a strong enough selected context for a bounded production cue, and no learner note supports a safer recognition card.`,
      recommended: false,
      warningCode: "improve-chunk-context",
      warning: "Capture the chunk in a clearer surrounding sentence or add a learner note before marking it ready.",
    };
  }

  if (boundedSentenceRecall(occurrenceSelection, cloze, tokenCount)) {
    return {
      ...selection,
      unitKind,
      cardKind: "context-recall",
      prompt: cloze!,
      answer: productionAnswer(surfaceText, canonicalText, note),
      reasonCode: "sentence-context-recall",
      reason: `This sentence has a bounded retrieval target with useful context on both sides, so contextual recall is supported without generated semantics.`,
      recommended: true,
    };
  }

  if (note) {
    return {
      ...selection,
      unitKind,
      cardKind: "sentence-review",
      prompt: canonicalText,
      answer: note,
      reasonCode: "sentence-note-review",
      reason: `Context does not support a bounded sentence-recall target, but the learner note supplies a concrete review purpose.`,
      recommended: true,
    };
  }

  return {
    ...selection,
    unitKind,
    cardKind: "sentence-review",
    prompt: canonicalText,
    answer: "",
    reasonCode: "reject-sentence-target",
    reason: `This sentence does not have a useful bounded retrieval target or an explicit learner note.`,
    recommended: false,
    warningCode: "narrow-sentence-target",
    warning: "Narrow the canonical target or add an explicit learner note before marking it ready.",
  };
}

export function deriveLearningStudyContent(item: CollectedItem): DerivedLearningStudyContent {
  const proposal = proposeLearningCard(item);
  const selectedOccurrence = proposal.occurrenceSelection?.occurrence;
  const semanticValues: Record<CollectorSemanticField, string> = {
    Prompt: proposal.prompt,
    Answer: proposal.answer,
    Canonical: item.lexicalUnit.canonicalText,
    Observed: selectedOccurrence?.surfaceText ?? item.lexicalUnit.canonicalText,
    Context: selectedOccurrence?.context ?? "",
    Note: item.lexicalUnit.note,
    Source: selectedOccurrence?.source.url ?? "",
    CardKind: proposal.cardKind,
    Why: proposal.reason,
  };

  return {
    proposal,
    ...(selectedOccurrence ? { selectedOccurrence } : {}),
    semanticValues,
  };
}

export function learningStudyContentSignature(item: CollectedItem): string {
  const derived = deriveLearningStudyContent(item);
  const values = derived.semanticValues;

  return JSON.stringify({
    recommended: derived.proposal.recommended,
    warningCode: derived.proposal.warningCode ?? "",
    unitKind: derived.proposal.unitKind,
    language: item.lexicalUnit.language,
    Prompt: values.Prompt,
    Answer: values.Answer,
    CardKind: values.CardKind,
    Why: values.Why,
    Canonical: values.Canonical,
    Observed: values.Observed,
    Context: values.Context,
    Note: values.Note,
    Source: values.Source,
  });
}
