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
   * The real semantic state immediately before the mutation being explained.
   * Omit it when no trustworthy before-state is available; the decision then
   * describes only the current snapshot and never fabricates event history.
   */
  previousItem?: CollectedItem;
}

export type LearningValueBaselines = Record<string, CollectedItem>;

function decision(
  kind: LearningValueDecisionKind,
  label: string,
  reasonCode: LearningValueReasonCode,
  reason: string,
): LearningValueDecision {
  return { kind, label, reasonCode, reason };
}

/**
 * Signature for inputs that can change learning-value semantics.
 *
 * Workflow status, timestamps on the lexical unit, and Anki linkage are
 * deliberately excluded. Occurrences are sorted by stable identity, not by
 * capturedAt, because capturedAt is source chronology rather than ingestion
 * order.
 */
export function learningEvidenceSignature(item: CollectedItem): string {
  return JSON.stringify({
    lexicalUnit: {
      id: item.lexicalUnit.id,
      contentKey: item.lexicalUnit.contentKey,
      canonicalText: item.lexicalUnit.canonicalText,
      normalizedCanonicalText: item.lexicalUnit.normalizedCanonicalText,
      language: item.lexicalUnit.language,
      note: item.lexicalUnit.note,
    },
    occurrences: [...item.occurrences]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((occurrence) => ({
        id: occurrence.id,
        lexicalUnitId: occurrence.lexicalUnitId,
        surfaceText: occurrence.surfaceText,
        normalizedSurfaceText: occurrence.normalizedSurfaceText,
        context: occurrence.context,
        source: occurrence.source,
        capturedAt: occurrence.capturedAt,
      })),
  });
}

/**
 * Preserve the actual pre-mutation item snapshot across side-panel reloads.
 *
 * A status-only reload keeps the existing baseline. A learning-relevant corpus
 * mutation replaces it with the immediately preceding loaded snapshot. New
 * identities have no before-state. Removed identities are discarded.
 */
export function reconcileLearningValueBaselines(
  previousItems: readonly CollectedItem[],
  currentItems: readonly CollectedItem[],
  existing: LearningValueBaselines,
): LearningValueBaselines {
  const previousById = new Map(
    previousItems.map((item) => [item.lexicalUnit.id, item]),
  );
  const next: LearningValueBaselines = {};

  for (const item of currentItems) {
    const id = item.lexicalUnit.id;
    const previous = previousById.get(id);
    if (
      previous
      && learningEvidenceSignature(previous) !== learningEvidenceSignature(item)
    ) {
      next[id] = previous;
      continue;
    }

    const retained = existing[id];
    if (retained) next[id] = retained;
  }

  return next;
}

export function deriveLearningValueDecision(
  input: LearningValueDecisionInput,
): LearningValueDecision {
  const { item, previousItem } = input;

  if (previousItem && previousItem.lexicalUnit.id !== item.lexicalUnit.id) {
    throw new Error("Learning-value comparison must stay within one lexical unit.");
  }

  const current = deriveLearningStudyContent(item);

  if (!current.proposal.recommended) {
    return decision(
      "archive",
      "Archive for now",
      "current-evidence-not-studyable",
      "Current evidence does not support a useful study card yet.",
    );
  }

  if (!previousItem) {
    return decision(
      "study",
      "Study",
      "current-useful-evidence",
      "Current evidence supports one useful study card.",
    );
  }

  if (previousItem.occurrences.length === 0) {
    return decision(
      "study",
      "Study",
      "first-useful-evidence",
      "First useful evidence supports one review card.",
    );
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
      "This mutation adds stronger selected context than the prior study evidence.",
    );
  }

  return decision(
    "study",
    "Study",
    "study-content-changed",
    "The study card remains useful, but its effective content changed and should be reviewed before approval.",
  );
}
