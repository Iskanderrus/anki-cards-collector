import type { CollectedItem } from "../core/types";
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
  | "current-useful-evidence"
  | "current-evidence-not-studyable"
  | "selected-evidence-improved"
  | "effective-study-content-unchanged";

export interface LearningValueDecision {
  kind: LearningValueDecisionKind;
  label: string;
  reasonCode: LearningValueReasonCode;
  reason: string;
}

export interface LearningValueDecisionInput {
  item: CollectedItem;
}

function decision(
  kind: LearningValueDecisionKind,
  label: string,
  reasonCode: LearningValueReasonCode,
  reason: string,
): LearningValueDecision {
  return { kind, label, reasonCode, reason };
}

/**
 * ACCP-007 is a corpus-relative classifier.
 *
 * It never reconstructs mutation order. The current ACCP-002-selected
 * occurrence is compared with the best deterministic counterfactual corpus
 * that remains when that selected occurrence is removed.
 *
 * Because both sides are derived from the same persisted CollectedItem, the
 * result is stable across side-panel/browser recreation for an unchanged
 * local corpus.
 */
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

  const currentSelection = current.proposal.occurrenceSelection;
  if (!currentSelection || item.occurrences.length <= 1) {
    return decision(
      "study",
      "Study",
      "current-useful-evidence",
      "Current corpus supports one useful study card.",
    );
  }

  const alternativeItem: CollectedItem = {
    lexicalUnit: item.lexicalUnit,
    occurrences: item.occurrences.filter(
      (occurrence) => occurrence.id !== currentSelection.occurrence.id,
    ),
  };
  const alternative = deriveLearningStudyContent(alternativeItem);

  if (alternative.proposal.recommended) {
    if (
      learningStudyContentSignature(alternativeItem)
      === learningStudyContentSignature(item)
    ) {
      return decision(
        "evidence-only",
        "Evidence only",
        "effective-study-content-unchanged",
        "The corpus already contains equivalent evidence for the same study card.",
      );
    }

  }

  const hasWeakerStudyableAlternative = item.occurrences
    .filter((occurrence) => occurrence.id !== currentSelection.occurrence.id)
    .some((occurrence) => {
      const alternative = deriveLearningStudyContent({
        lexicalUnit: item.lexicalUnit,
        occurrences: [occurrence],
      });
      const alternativeSelection = alternative.proposal.occurrenceSelection;
      return (
        alternative.proposal.recommended
        && alternativeSelection !== undefined
        && currentSelection.score > alternativeSelection.score
      );
    });

  if (hasWeakerStudyableAlternative) {
    return decision(
      "improve",
      "Improve",
      "selected-evidence-improved",
      "The selected evidence is stronger than other studyable evidence in this corpus.",
    );
  }

  return decision(
    "study",
    "Study",
    "current-useful-evidence",
    "Current corpus supports one useful study card.",
  );
}
