import type { CollectedItem } from "../core/types";

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

function latestContext(item: CollectedItem): string {
  return item.occurrences.at(-1)?.context.trim() ?? "";
}

function contextualPrompt(context: string, expression: string): string | null {
  if (!context || !expression) return null;

  const lowerContext = context.toLocaleLowerCase();
  const lowerExpression = expression.toLocaleLowerCase();
  const index = lowerContext.indexOf(lowerExpression);
  if (index < 0) return null;

  const before = context.slice(0, index);
  const after = context.slice(index + expression.length);
  const residual = `${before} ${after}`;
  if (wordTokens(residual).length < MIN_RESIDUAL_CONTEXT_WORDS) return null;

  return `${before}[…]${after}`.replace(/\s+/g, " ").trim();
}

function answerWithNote(expression: string, note: string): string {
  const cleanNote = note.trim();
  return cleanNote ? `${expression}\n\n${cleanNote}` : expression;
}

function repeatedEncounterReason(item: CollectedItem): string {
  return item.occurrences.length > 1
    ? ` Seen ${item.occurrences.length} times; keep one learning target and reuse the accumulated evidence.`
    : "";
}

export function proposeLearningCard(item: CollectedItem): LearningCardProposal {
  const expression = item.lexicalUnit.displayText.trim();
  const note = item.lexicalUnit.note.trim();
  const context = latestContext(item);
  const unitKind = classifyLearningUnit(expression);
  const tokenCount = wordTokens(expression).length;
  const repeated = repeatedEncounterReason(item);

  if (tokenCount > MAX_CAPTURE_WORDS || expression.length > MAX_CAPTURE_CHARS) {
    return {
      unitKind,
      cardKind: "sentence-review",
      prompt: expression,
      answer: note || context,
      reason: `The capture is too broad for one retrieval target.${repeated}`,
      recommended: false,
      warning: "Shorten the capture or isolate the part you actually want to retrieve before marking it ready.",
    };
  }

  const cloze = contextualPrompt(context, expression);

  if (unitKind === "chunk" && cloze) {
    return {
      unitKind,
      cardKind: "context-production",
      prompt: cloze,
      answer: answerWithNote(expression, note),
      reason: `A multi-word expression with usable context is better practiced as one contextual production target.${repeated}`,
      recommended: true,
    };
  }

  if (unitKind === "sentence") {
    if (cloze) {
      return {
        unitKind,
        cardKind: "context-recall",
        prompt: cloze,
        answer: answerWithNote(expression, note),
        reason: `The sentence has enough surrounding context to support recall without inventing extra semantic information.${repeated}`,
        recommended: true,
      };
    }

    if (note) {
      return {
        unitKind,
        cardKind: "sentence-review",
        prompt: expression,
        answer: note,
        reason: `A learner note gives this sentence a concrete review target even without broader context.${repeated}`,
        recommended: true,
      };
    }

    return {
      unitKind,
      cardKind: "sentence-review",
      prompt: expression,
      answer: context,
      reason: `This sentence does not yet have a clear retrieval target.${repeated}`,
      recommended: false,
      warning: "Add a learner note or narrow the selection before marking it ready.",
    };
  }

  if (unitKind === "word" && note) {
    return {
      unitKind,
      cardKind: "context-recognition",
      prompt: expression,
      answer: `${note}${context ? `\n\nContext: ${context}` : ""}`,
      reason: `A single lexical item with an explicit learner note can be reviewed without inferring a meaning automatically.${repeated}`,
      recommended: true,
    };
  }

  if (unitKind === "word" && context) {
    return {
      unitKind,
      cardKind: "context-recognition",
      prompt: expression,
      answer: context,
      reason: `No meaning is generated automatically; the original context remains the evidence for this recognition card.${repeated}`,
      recommended: true,
    };
  }

  return {
    unitKind,
    cardKind: "context-recognition",
    prompt: expression,
    answer: note,
    reason: `There is not enough context to construct a useful card safely.${repeated}`,
    recommended: false,
    warning: "Capture the expression in context or add a learner note before marking it ready.",
  };
}
