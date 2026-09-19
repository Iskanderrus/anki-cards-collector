import type { CollectedItem } from "../core/types";
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

export interface LearningCardProposal {
  unitKind: LearningUnitKind;
  cardKind: LearningCardKind;
  prompt: string;
  answer: string;
  reason: string;
  recommended: boolean;
  warning?: string;
  occurrenceSelection?: OccurrenceSelection;
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

function canonicalSuffix(surfaceText: string, canonicalText: string): string {
  return normalizeIdentityText(surfaceText) === normalizeIdentityText(canonicalText)
    ? ""
    : \`\n\nCanonical: \${canonicalText}\`;
}

function productionAnswer(surfaceText: string, canonicalText: string, note: string): string {
  const cleanNote = note.trim();
  return [
    surfaceText,
    normalizeIdentityText(surfaceText) === normalizeIdentityText(canonicalText)
      ? ""
      : \`Canonical: \${canonicalText}\`,
    cleanNote,
  ].filter(Boolean).join("\n\n");
}

function repeatedEncounterReason(item: CollectedItem): string {
  return item.occurrences.length > 1
    ? \` Seen \${item.occurrences.length} times; keep one canonical learning target and reuse the accumulated evidence.\`
    : "";
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
  const repeated = repeatedEncounterReason(item);
  const selection = occurrenceSelection ? { occurrenceSelection } : {};

  if (tokenCount > MAX_CAPTURE_WORDS || canonicalText.length > MAX_CAPTURE_CHARS) {
    return {
      ...selection,
      unitKind,
      cardKind: "sentence-review",
      prompt: canonicalText,
      answer: note || context,
      reason: \`The canonical target is too broad for one retrieval task.\${repeated}\`,
      recommended: false,
      warning: "Shorten the canonical form or isolate the part you actually want to retrieve before marking it ready.",
    };
  }

  const cloze = buildContextualPrompt(
    context,
    surfaceText,
    MIN_RESIDUAL_CONTEXT_WORDS,
  );

  if (unitKind === "chunk" && cloze) {
    return {
      ...selection,
      unitKind,
      cardKind: "context-production",
      prompt: cloze,
      answer: productionAnswer(surfaceText, canonicalText, note),
      reason: \`A multi-word canonical unit with an observed form in usable context is better practiced as one contextual production target.\${repeated}\`,
      recommended: true,
    };
  }

  if (unitKind === "sentence") {
    if (cloze) {
      return {
        ...selection,
        unitKind,
        cardKind: "context-recall",
        prompt: cloze,
        answer: productionAnswer(surfaceText, canonicalText, note),
        reason: \`The observed sentence has enough surrounding context to support recall without inventing extra semantic information.\${repeated}\`,
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
        reason: \`A learner note gives this canonical sentence a concrete review target even without broader context.\${repeated}\`,
        recommended: true,
      };
    }

    return {
      ...selection,
      unitKind,
      cardKind: "sentence-review",
      prompt: canonicalText,
      answer: context,
      reason: \`This sentence does not yet have a clear retrieval target.\${repeated}\`,
      recommended: false,
      warning: "Add a learner note or narrow the canonical form before marking it ready.",
    };
  }

  if (unitKind === "word" && note) {
    return {
      ...selection,
      unitKind,
      cardKind: "context-recognition",
      prompt: surfaceText,
      answer: \`\${note}\${canonicalSuffix(surfaceText, canonicalText)}\${context ? \`\n\nContext: \${context}\` : ""}\`,
      reason: \`A single observed form with an explicit learner note can be reviewed while keeping its canonical unit visible.\${repeated}\`,
      recommended: true,
    };
  }

  if (unitKind === "word" && context) {
    return {
      ...selection,
      unitKind,
      cardKind: "context-recognition",
      prompt: surfaceText,
      answer: \`\${canonicalSuffix(surfaceText, canonicalText).trim()}\${canonicalSuffix(surfaceText, canonicalText) ? "\n\n" : ""}\${context}\`,
      reason: \`No meaning is generated automatically; the observed form and original context remain the evidence for this recognition card.\${repeated}\`,
      recommended: true,
    };
  }

  return {
    ...selection,
    unitKind,
    cardKind: "context-recognition",
    prompt: surfaceText,
    answer: note,
    reason: \`There is not enough context to construct a useful card safely.\${repeated}\`,
    recommended: false,
    warning: "Capture the form in context or add a learner note before marking it ready.",
  };
}
