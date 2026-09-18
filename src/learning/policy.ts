import type { CollectedItem } from "../core/types";
import { normalizeIdentityText } from "../core/normalize";

export type LearningUnitKind = "word" | "chunk" | "sentence";
export type LearningCardKind =
  | "context-recognition"
  | "context-production"
  | "context-recall"
  | "sentence-review";

export interface LearningCardProposal {
  unitKind: LearningUnitKind;
  cardKind: LearningCardKind;
  prompt: string;
  answer: string;
  reason: string;
  recommended: boolean;
  warning?: string;
}

const MAX_CAPTURE_WORDS = 25;
const MAX_CAPTURE_CHARS = 180;
const MAX_CHUNK_WORDS = 7;
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

function latestOccurrence(item: CollectedItem) {
  return item.occurrences.at(-1);
}

function contextualPrompt(context: string, surfaceText: string): string | null {
  if (!context || !surfaceText) return null;

  const lowerContext = context.toLocaleLowerCase();
  const lowerSurface = surfaceText.toLocaleLowerCase();
  const index = lowerContext.indexOf(lowerSurface);
  if (index < 0) return null;

  const before = context.slice(0, index);
  const after = context.slice(index + surfaceText.length);
  const residual = `${before} ${after}`;
  if (wordTokens(residual).length < MIN_RESIDUAL_CONTEXT_WORDS) return null;

  return `${before}[…]${after}`.replace(/\s+/g, " ").trim();
}

function canonicalSuffix(surfaceText: string, canonicalText: string): string {
  return normalizeIdentityText(surfaceText) === normalizeIdentityText(canonicalText)
    ? ""
    : `\n\nCanonical: ${canonicalText}`;
}

function productionAnswer(surfaceText: string, canonicalText: string, note: string): string {
  const cleanNote = note.trim();
  return [
    surfaceText,
    normalizeIdentityText(surfaceText) === normalizeIdentityText(canonicalText)
      ? ""
      : `Canonical: ${canonicalText}`,
    cleanNote,
  ].filter(Boolean).join("\n\n");
}

function repeatedEncounterReason(item: CollectedItem): string {
  return item.occurrences.length > 1
    ? ` Seen ${item.occurrences.length} times; keep one canonical learning target and reuse the accumulated evidence.`
    : "";
}

export function proposeLearningCard(item: CollectedItem): LearningCardProposal {
  const canonicalText = item.lexicalUnit.canonicalText.trim();
  const note = item.lexicalUnit.note.trim();
  const occurrence = latestOccurrence(item);
  const surfaceText = occurrence?.surfaceText.trim() || canonicalText;
  const context = occurrence?.context.trim() ?? "";
  const unitKind = classifyLearningUnit(canonicalText);
  const tokenCount = wordTokens(canonicalText).length;
  const repeated = repeatedEncounterReason(item);

  if (tokenCount > MAX_CAPTURE_WORDS || canonicalText.length > MAX_CAPTURE_CHARS) {
    return {
      unitKind,
      cardKind: "sentence-review",
      prompt: canonicalText,
      answer: note || context,
      reason: `The canonical target is too broad for one retrieval task.${repeated}`,
      recommended: false,
      warning: "Shorten the canonical form or isolate the part you actually want to retrieve before marking it ready.",
    };
  }

  const cloze = contextualPrompt(context, surfaceText);

  if (unitKind === "chunk" && cloze) {
    return {
      unitKind,
      cardKind: "context-production",
      prompt: cloze,
      answer: productionAnswer(surfaceText, canonicalText, note),
      reason: `A multi-word canonical unit with an observed form in usable context is better practiced as one contextual production target.${repeated}`,
      recommended: true,
    };
  }

  if (unitKind === "sentence") {
    if (cloze) {
      return {
        unitKind,
        cardKind: "context-recall",
        prompt: cloze,
        answer: productionAnswer(surfaceText, canonicalText, note),
        reason: `The observed sentence has enough surrounding context to support recall without inventing extra semantic information.${repeated}`,
        recommended: true,
      };
    }

    if (note) {
      return {
        unitKind,
        cardKind: "sentence-review",
        prompt: canonicalText,
        answer: note,
        reason: `A learner note gives this canonical sentence a concrete review target even without broader context.${repeated}`,
        recommended: true,
      };
    }

    return {
      unitKind,
      cardKind: "sentence-review",
      prompt: canonicalText,
      answer: context,
      reason: `This sentence does not yet have a clear retrieval target.${repeated}`,
      recommended: false,
      warning: "Add a learner note or narrow the canonical form before marking it ready.",
    };
  }

  if (unitKind === "word" && note) {
    return {
      unitKind,
      cardKind: "context-recognition",
      prompt: surfaceText,
      answer: `${note}${canonicalSuffix(surfaceText, canonicalText)}${context ? `\n\nContext: ${context}` : ""}`,
      reason: `A single observed form with an explicit learner note can be reviewed while keeping its canonical unit visible.${repeated}`,
      recommended: true,
    };
  }

  if (unitKind === "word" && context) {
    return {
      unitKind,
      cardKind: "context-recognition",
      prompt: surfaceText,
      answer: `${canonicalSuffix(surfaceText, canonicalText).trim()}${canonicalSuffix(surfaceText, canonicalText) ? "\n\n" : ""}${context}`,
      reason: `No meaning is generated automatically; the observed form and original context remain the evidence for this recognition card.${repeated}`,
      recommended: true,
    };
  }

  return {
    unitKind,
    cardKind: "context-recognition",
    prompt: surfaceText,
    answer: note,
    reason: `There is not enough context to construct a useful card safely.${repeated}`,
    recommended: false,
    warning: "Capture the form in context or add a learner note before marking it ready.",
  };
}
