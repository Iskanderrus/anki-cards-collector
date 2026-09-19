import type { Occurrence } from "../core/types";
import { normalizeIdentityText } from "../core/normalize";

export interface OccurrenceQualityBreakdown {
  targetPresence: number;
  surroundingContext: number;
  residualContext: number;
  contextLength: number;
  noisePenalty: number;
  clozeUsability: number;
  total: number;
  targetInContext: boolean;
  beforeWords: number;
  afterWords: number;
  residualWords: number;
  contextWords: number;
}

export interface OccurrenceSelection {
  occurrence: Occurrence;
  score: number;
  breakdown: OccurrenceQualityBreakdown;
  reason: string;
  selectedNumber: number;
  occurrenceCount: number;
  recencyTieBreak: boolean;
}

export interface OccurrenceSelectionOptions {
  preferContextualCloze?: boolean;
  minResidualContextWords?: number;
}

const TOKEN_PATTERN = /[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;
const DEFAULT_MIN_RESIDUAL_CONTEXT_WORDS = 4;

function wordTokens(text: string): string[] {
  return text.match(TOKEN_PATTERN) ?? [];
}

export function findSurfaceIndex(context: string, surfaceText: string): number {
  const cleanContext = context.trim();
  const cleanSurface = surfaceText.trim();
  if (!cleanContext || !cleanSurface) return -1;

  return cleanContext.toLocaleLowerCase().indexOf(cleanSurface.toLocaleLowerCase());
}

export function buildContextualPrompt(
  context: string,
  surfaceText: string,
  minResidualWords = DEFAULT_MIN_RESIDUAL_CONTEXT_WORDS,
): string | null {
  const cleanContext = context.trim();
  const cleanSurface = surfaceText.trim();
  const index = findSurfaceIndex(cleanContext, cleanSurface);
  if (index < 0) return null;

  const before = cleanContext.slice(0, index);
  const after = cleanContext.slice(index + cleanSurface.length);
  const residual = \`\${before} \${after}\`;
  if (wordTokens(residual).length < minResidualWords) return null;

  return \`\${before}[…]\${after}\`.replace(/\s+/g, " ").trim();
}

function contextLengthScore(contextWords: number): number {
  if (contextWords === 0) return -20;
  if (contextWords >= 5 && contextWords <= 30) return 15;
  if (contextWords >= 3 && contextWords <= 50) return 8;
  if (contextWords <= 80) return 3;
  return -8;
}

function noisePenalty(context: string): number {
  if (!context.trim()) return 0;

  let penalty = 0;
  if (/https?:\/\/|www\./i.test(context)) penalty -= 15;
  if (/[!?.,;:…]{4,}/u.test(context)) penalty -= 5;

  const visible = [...context].filter((character) => !/\s/u.test(character));
  if (visible.length > 0) {
    const noisy = visible.filter(
      (character) => !/[\p{L}\p{M}\p{N}'’\-.,!?;:()[\]{}"“”„«»…]/u.test(character),
    ).length;
    const ratio = noisy / visible.length;
    if (ratio > 0.18) penalty -= 12;
    else if (ratio > 0.08) penalty -= 5;
  }

  return penalty;
}

function scoreOccurrence(
  occurrence: Occurrence,
  options: Required<OccurrenceSelectionOptions>,
): OccurrenceQualityBreakdown {
  const context = occurrence.context.trim();
  const surfaceText = occurrence.surfaceText.trim();
  const targetIndex = findSurfaceIndex(context, surfaceText);
  const targetInContext = targetIndex >= 0;
  const contextWords = wordTokens(context).length;

  let beforeWords = 0;
  let afterWords = 0;
  if (targetInContext) {
    beforeWords = wordTokens(context.slice(0, targetIndex)).length;
    afterWords = wordTokens(
      context.slice(targetIndex + surfaceText.length),
    ).length;
  }
  const residualWords = beforeWords + afterWords;

  const targetPresence = targetInContext ? 40 : 0;
  const surroundingContext = targetInContext
    ? beforeWords > 0 && afterWords > 0
      ? 18
      : beforeWords > 0 || afterWords > 0
        ? 8
        : 0
    : 0;
  const residualContext = residualWords >= options.minResidualContextWords
    ? 15
    : residualWords >= 2
      ? 6
      : 0;
  const length = contextLengthScore(contextWords);
  const noise = noisePenalty(context);
  const clozeUsability = options.preferContextualCloze
    ? buildContextualPrompt(
        context,
        surfaceText,
        options.minResidualContextWords,
      )
      ? 25
      : -10
    : 0;

  const total =
    targetPresence
    + surroundingContext
    + residualContext
    + length
    + noise
    + clozeUsability;

  return {
    targetPresence,
    surroundingContext,
    residualContext,
    contextLength: length,
    noisePenalty: noise,
    clozeUsability,
    total,
    targetInContext,
    beforeWords,
    afterWords,
    residualWords,
    contextWords,
  };
}

function chronologicalCompare(left: Occurrence, right: Occurrence): number {
  const byTime = left.capturedAt.localeCompare(right.capturedAt);
  if (byTime !== 0) return byTime;
  return left.id.localeCompare(right.id);
}

function qualityReason(
  breakdown: OccurrenceQualityBreakdown,
  preferContextualCloze: boolean,
  recencyTieBreak: boolean,
): string {
  const parts: string[] = [];

  if (breakdown.targetInContext) {
    parts.push("observed form appears in context");
  } else {
    parts.push("observed form is not present in context");
  }

  if (breakdown.beforeWords > 0 && breakdown.afterWords > 0) {
    parts.push("context exists on both sides");
  } else if (breakdown.residualWords > 0) {
    parts.push("some surrounding context remains");
  } else {
    parts.push("no surrounding words remain");
  }

  if (preferContextualCloze) {
    parts.push(
      breakdown.clozeUsability > 0
        ? "usable contextual blank"
        : "not enough context for a contextual blank",
    );
  }

  if (breakdown.contextWords > 80) {
    parts.push("context is very long");
  } else if (breakdown.contextWords > 0) {
    parts.push(\`\${breakdown.contextWords}-word context\`);
  } else {
    parts.push("empty context");
  }

  if (breakdown.noisePenalty < 0) {
    parts.push("noise penalty applied");
  } else if (breakdown.contextWords > 0) {
    parts.push("no obvious noise penalty");
  }

  if (recencyTieBreak) {
    parts.push("quality tied, so the newer capture won the tie");
  }

  return \`Score \${breakdown.total}: \${parts.join("; ")}.\`;
}

export function selectBestOccurrence(
  occurrences: Occurrence[],
  options: OccurrenceSelectionOptions = {},
): OccurrenceSelection | null {
  if (occurrences.length === 0) return null;

  const resolvedOptions: Required<OccurrenceSelectionOptions> = {
    preferContextualCloze: options.preferContextualCloze ?? false,
    minResidualContextWords:
      options.minResidualContextWords ?? DEFAULT_MIN_RESIDUAL_CONTEXT_WORDS,
  };

  const scored = occurrences.map((occurrence) => ({
    occurrence,
    breakdown: scoreOccurrence(occurrence, resolvedOptions),
  }));

  scored.sort((left, right) => {
    const byScore = right.breakdown.total - left.breakdown.total;
    if (byScore !== 0) return byScore;

    const byRecency = right.occurrence.capturedAt.localeCompare(
      left.occurrence.capturedAt,
    );
    if (byRecency !== 0) return byRecency;

    return left.occurrence.id.localeCompare(right.occurrence.id);
  });

  const selected = scored[0]!;
  const recencyTieBreak =
    scored.length > 1
    && scored[1]!.breakdown.total === selected.breakdown.total
    && scored[1]!.occurrence.capturedAt !== selected.occurrence.capturedAt;

  const chronological = [...occurrences].sort(chronologicalCompare);
  const selectedNumber =
    chronological.findIndex((occurrence) => occurrence.id === selected.occurrence.id) + 1;

  return {
    occurrence: selected.occurrence,
    score: selected.breakdown.total,
    breakdown: selected.breakdown,
    reason: qualityReason(
      selected.breakdown,
      resolvedOptions.preferContextualCloze,
      recencyTieBreak,
    ),
    selectedNumber,
    occurrenceCount: occurrences.length,
    recencyTieBreak,
  };
}

export function sameObservedForm(left: Occurrence, right: Occurrence): boolean {
  return normalizeIdentityText(left.surfaceText) === normalizeIdentityText(right.surfaceText);
}
