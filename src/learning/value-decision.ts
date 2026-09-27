import type { CollectedItem, Occurrence } from "../core/types";
import {
  deriveLearningStudyContent,
  learningStudyContentSignature,
} from "./policy";

export type LearningValueDecisionKind =
  | "study"
  | "improve"
  | "evidence-only"
  | "archive";

export type LearningValueReasonCode =
  | "first-useful-evidence"
  | "current-evidence-not-studyable"
  | "new-evidence-makes-studyable"
  | "selected-evidence-improved"
  | "effective-study-content-unchanged"
  | "study-content-changed";

export interface LearningValueDecision {
  kind: LearningValueDecisionKind;
  label: string;
  reasonCode: LearningValueReasonCode;
  reason: string;
}

export interface LearningValueDecisionInput {
  item: CollectedItem;
  /**
   * Optional semantic "before" state for mutation-level comparisons.
   * Review UI normally omits this and derives the previous evidence boundary
   * from the current lexical unit's local occurrence history.
   */
  previousItem?: CollectedItem;
}

function occurrenceChronology(left: Occurrence, right: Occurrence): number {
  return left.capturedAt.localeCompare(right.capturedAt) || left.id.localeCompare(right.id);
}

export function previousEvidenceItem(item: CollectedItem): CollectedItem | null {
  if (item.occurrences.length <= 1) return null;

  const newest = [...item.occurrences].sort(occurrenceChronology).at(-1);
  if (!newest) return null;

  return {
    lexicalUnit: item.lexicalUnit,
    occurrences: item.occurrences.filter((occurrence) => occurrence.id !== newest.id),
  };
}

function decision(
  kind: LearningValueDecisionKind,
  label: string,
  reasonCode: LearningValueReasonCode,
  reason: string,
): LearningValueDecision {
  return { kind, label, reasonCode, reason };
}

export function deriveLearningValueDecision(
  input: LearningValueDecisionInput,
): LearningValueDecision {
  const { item } = input;
  const current = deriveLearningStudyContent(item);

  if (!current.proposal.recommended) {
    return decision(
      "archive",
      "Archive for now",
      "current-evidence-not-studyable",
      "Current evidence does not support a useful study card yet.",
    );
  }

  const previousItem = input.previousItem ?? previousEvidenceItem(item);
  if (!previousItem || previousItem.occurrences.length === 0) {
    return decision(
      "study",
      "Study",
      "first-useful-evidence",
      "First useful evidence supports one review card.",
    );
  }

  if (previousItem.lexicalUnit.id !== item.lexicalUnit.id) {
    throw new Error("Learning-value comparison must stay within one lexical unit.");
  }

  const previous = deriveLearningStudyContent(previousItem);
  if (!previous.proposal.recommended) {
    return decision(
      "improve",
      "Improve",
      "new-evidence-makes-studyable",
      "New evidence makes a useful study card possible.",
    );
  }

  if (learningStudyContentSignature(previousItem) === learningStudyContentSignature(item)) {
    return decision(
      "evidence-only",
      "Evidence only",
      "effective-study-content-unchanged",
      "This encounter adds evidence, but the current study card is unchanged.",
    );
  }

  const previousSelection = previous.proposal.occurrenceSelection;
  const currentSelection = current.proposal.occurrenceSelection;
  if (
    previousSelection
    && currentSelection
    && previousSelection.occurrence.id !== currentSelection.occurrence.id
    && currentSelection.score > previousSelection.score
  ) {
    return decision(
      "improve",
      "Improve",
      "selected-evidence-improved",
      "This occurrence provides stronger selected context than the evidence currently used for the card.",
    );
  }

  return decision(
    "study",
    "Study",
    "study-content-changed",
    "The study card remains useful, but its effective content changed and should be reviewed before approval.",
  );
}
