import { makeContentKey, normalizeIdentityText, normalizeLanguage, normalizeText } from "../core/normalize";
import type { CaptureSource, CollectedItem } from "../core/types";
import type { CaptureBatchEntry, CaptureRepository } from "../storage/repository";

export type CandidateDisposition =
  | "new"
  | "already-represented"
  | "repeated-evidence"
  | "needs-review";

const CANDIDATE_DISPOSITIONS = new Set<CandidateDisposition>([
  "new",
  "already-represented",
  "repeated-evidence",
  "needs-review",
]);

export type BatchAdapterMetadata = Record<string, string | number | boolean | null>;

export interface BatchCaptureEvidence {
  surfaceText: string;
  context: string;
  language: string;
  source: CaptureSource;
  capturedAt: string;
  adapterMetadata?: BatchAdapterMetadata;
}

export interface BatchCaptureCandidate extends BatchCaptureEvidence {
  id: string;
  batchId: string;
  normalizedSurfaceText: string;
  normalizedContext: string;
  duplicateCount: number;
  disposition: CandidateDisposition;
  matchingLexicalUnitIds: string[];
}

export interface BatchCaptureResult {
  batchId: string;
  receivedCount: number;
  ignoredEmptyCount: number;
  duplicatesCollapsed: number;
  nextCandidateNumber?: number;
  candidates: BatchCaptureCandidate[];
}

export interface BatchSourceAdapter {
  readonly id: string;
  collect(): readonly BatchCaptureEvidence[] | Promise<readonly BatchCaptureEvidence[]>;
}

export interface BatchCommitRequest {
  candidateIds: string[];
  resolutions?: Record<string, string>;
}

export interface BatchCandidateEdit {
  surfaceText?: string;
  language?: string;
  context?: string;
}

export interface BatchCommitSummary {
  newUnits: number;
  evidenceAdded: number;
  unchanged: number;
  needsReview: number;
}

export interface BatchCommitResult {
  committed: Array<{
    candidateId: string;
    item: CollectedItem;
  }>;
  unchangedCandidateIds: string[];
  remainingCandidateIds: string[];
  summary: BatchCommitSummary;
  warning?: string;
}

function sourceFingerprint(source: CaptureSource): string {
  return [source.kind, source.adapter, source.url, source.title].join("\u0000");
}

function duplicateFingerprint(candidate: BatchCaptureEvidence): string {
  // Adapter metadata is intentionally excluded from persisted-evidence identity.
  // Occurrences cannot store it, so metadata-only differences must not survive
  // staging as separate candidates that would become identical persisted rows.
  return [
    normalizeLanguage(candidate.language),
    normalizeIdentityText(candidate.surfaceText),
    normalizeText(candidate.context),
    sourceFingerprint(candidate.source),
  ].join("\u0000");
}

function occurrenceEvidenceFingerprint(
  language: string,
  surfaceText: string,
  context: string,
  source: CaptureSource,
): string {
  return [
    normalizeLanguage(language),
    normalizeIdentityText(surfaceText),
    normalizeText(context),
    sourceFingerprint(source),
  ].join("\u0000");
}

function cloneResult(result: BatchCaptureResult): BatchCaptureResult {
  return {
    ...result,
    candidates: result.candidates.map((candidate) => ({
      ...candidate,
      source: { ...candidate.source },
      adapterMetadata: candidate.adapterMetadata
        ? { ...candidate.adapterMetadata }
        : undefined,
      matchingLexicalUnitIds: [...candidate.matchingLexicalUnitIds],
    })),
  };
}

export class BatchCapturePipeline {
  private activeBatch: BatchCaptureResult | null = null;

  constructor(private readonly repository: CaptureRepository) {}

  getActiveBatch(): BatchCaptureResult | null {
    return this.activeBatch ? cloneResult(this.activeBatch) : null;
  }

  restoreActiveBatch(snapshot: BatchCaptureResult): BatchCaptureResult {
    const batchId = snapshot.batchId.trim();
    if (!batchId) throw new Error("Stored staged batch ID is missing.");
    if (
      !Number.isInteger(snapshot.receivedCount) || snapshot.receivedCount < 0
      || !Number.isInteger(snapshot.ignoredEmptyCount) || snapshot.ignoredEmptyCount < 0
      || !Number.isInteger(snapshot.duplicatesCollapsed) || snapshot.duplicatesCollapsed < 0
    ) {
      throw new Error("Stored staged batch counters are invalid.");
    }

    const seenIds = new Set<string>();
    let observedNextCandidateNumber = 1;
    const candidates = snapshot.candidates.map((candidate) => {
      const id = candidate.id.trim();
      if (!id || seenIds.has(id)) {
        throw new Error("Stored staged candidate IDs must be non-empty and unique.");
      }
      if (candidate.batchId !== batchId || !id.startsWith(`${batchId}:`)) {
        throw new Error(`Stored staged candidate ${id || "(missing)"} does not belong to batch ${batchId}.`);
      }
      const numericId = Number(id.slice(batchId.length + 1));
      if (!Number.isInteger(numericId) || numericId < 1) {
        throw new Error(`Stored staged candidate ${id} has an invalid sequence number.`);
      }
      observedNextCandidateNumber = Math.max(observedNextCandidateNumber, numericId + 1);
      if (!Number.isInteger(candidate.duplicateCount) || candidate.duplicateCount < 1) {
        throw new Error(`Stored staged candidate ${id} has an invalid duplicate count.`);
      }
      if (!CANDIDATE_DISPOSITIONS.has(candidate.disposition)) {
        throw new Error(`Stored staged candidate ${id} has an invalid disposition.`);
      }

      const surfaceText = normalizeText(candidate.surfaceText);
      if (!surfaceText) throw new Error(`Stored staged candidate ${id} has empty observed text.`);
      seenIds.add(id);

      return {
        ...candidate,
        id,
        batchId,
        surfaceText,
        context: normalizeText(candidate.context).slice(0, 800),
        language: normalizeLanguage(candidate.language),
        source: { ...candidate.source },
        capturedAt: candidate.capturedAt,
        adapterMetadata: candidate.adapterMetadata ? { ...candidate.adapterMetadata } : undefined,
        normalizedSurfaceText: normalizeIdentityText(surfaceText),
        normalizedContext: normalizeText(candidate.context).slice(0, 800),
        matchingLexicalUnitIds: [...candidate.matchingLexicalUnitIds],
      };
    });

    const nextCandidateNumber = snapshot.nextCandidateNumber ?? observedNextCandidateNumber;
    if (!Number.isInteger(nextCandidateNumber) || nextCandidateNumber < observedNextCandidateNumber) {
      throw new Error("Stored staged candidate sequence high-water mark is invalid.");
    }

    this.activeBatch = {
      batchId,
      receivedCount: snapshot.receivedCount,
      ignoredEmptyCount: snapshot.ignoredEmptyCount,
      duplicatesCollapsed: snapshot.duplicatesCollapsed,
      nextCandidateNumber,
      candidates,
    };
    return cloneResult(this.activeBatch);
  }

  async stageFromAdapter(
    batchId: string,
    adapter: BatchSourceAdapter,
  ): Promise<BatchCaptureResult> {
    return this.stageBatch(batchId, await adapter.collect());
  }

  async stageBatch(
    batchId: string,
    evidence: readonly BatchCaptureEvidence[],
  ): Promise<BatchCaptureResult> {
    const normalizedBatchId = batchId.trim();
    if (!normalizedBatchId) throw new Error("Batch ID is required.");

    const uniqueCandidates: BatchCaptureCandidate[] = [];
    const byFingerprint = new Map<string, BatchCaptureCandidate>();
    const previousCandidates = this.activeBatch?.batchId === normalizedBatchId
      ? this.activeBatch.candidates
      : [];
    const previousIdsByFingerprint = new Map(
      previousCandidates.map((candidate) => [duplicateFingerprint(candidate), candidate.id]),
    );
    const usedIds = new Set(previousCandidates.map((candidate) => candidate.id));
    const observedNextCandidateNumber = previousCandidates.reduce((next, candidate) => {
      const prefix = `${normalizedBatchId}:`;
      if (!candidate.id.startsWith(prefix)) return next;
      const numeric = Number(candidate.id.slice(prefix.length));
      return Number.isInteger(numeric) && numeric >= next ? numeric + 1 : next;
    }, 1);
    let nextCandidateNumber = this.activeBatch?.batchId === normalizedBatchId
      ? Math.max(this.activeBatch.nextCandidateNumber ?? 1, observedNextCandidateNumber)
      : 1;
    const allocateCandidateId = (): string => {
      let candidateId: string;
      do {
        candidateId = `${normalizedBatchId}:${String(nextCandidateNumber).padStart(4, "0")}`;
        nextCandidateNumber += 1;
      } while (usedIds.has(candidateId));
      usedIds.add(candidateId);
      return candidateId;
    };
    let ignoredEmptyCount = 0;

    for (const value of evidence) {
      const surfaceText = normalizeText(value.surfaceText);
      if (!surfaceText) {
        ignoredEmptyCount += 1;
        continue;
      }

      const normalized: BatchCaptureEvidence = {
        surfaceText,
        context: normalizeText(value.context).slice(0, 800),
        language: normalizeLanguage(value.language),
        source: { ...value.source },
        capturedAt: value.capturedAt || new Date().toISOString(),
        adapterMetadata: value.adapterMetadata ? { ...value.adapterMetadata } : undefined,
      };
      const fingerprint = duplicateFingerprint(normalized);
      const duplicate = byFingerprint.get(fingerprint);

      if (duplicate) {
        duplicate.duplicateCount += 1;
        continue;
      }

      const candidate: BatchCaptureCandidate = {
        ...normalized,
        id: previousIdsByFingerprint.get(fingerprint) ?? allocateCandidateId(),
        batchId: normalizedBatchId,
        normalizedSurfaceText: normalizeIdentityText(surfaceText),
        normalizedContext: normalizeText(normalized.context),
        duplicateCount: 1,
        disposition: "new",
        matchingLexicalUnitIds: [],
      };
      uniqueCandidates.push(candidate);
      byFingerprint.set(fingerprint, candidate);
    }

    const candidates = await this.classify(uniqueCandidates);
    this.activeBatch = {
      batchId: normalizedBatchId,
      receivedCount: evidence.length,
      ignoredEmptyCount,
      duplicatesCollapsed: evidence.length - ignoredEmptyCount - candidates.length,
      nextCandidateNumber,
      candidates,
    };

    return cloneResult(this.activeBatch);
  }

  discard(): void {
    this.activeBatch = null;
  }

  async editCandidate(
    candidateId: string,
    changes: BatchCandidateEdit,
  ): Promise<BatchCaptureResult> {
    if (!this.activeBatch) throw new Error("No staged batch is active.");

    const index = this.activeBatch.candidates.findIndex(
      (candidate) => candidate.id === candidateId,
    );
    if (index < 0) throw new Error(`Unknown staged candidate: ${candidateId}`);

    const current = this.activeBatch.candidates[index]!;
    const surfaceText = changes.surfaceText === undefined
      ? current.surfaceText
      : normalizeText(changes.surfaceText);
    if (!surfaceText) throw new Error("Observed text cannot be empty.");

    const context = changes.context === undefined
      ? current.context
      : normalizeText(changes.context).slice(0, 800);
    const language = changes.language === undefined
      ? current.language
      : normalizeLanguage(changes.language);

    const edited: BatchCaptureCandidate = {
      ...current,
      surfaceText,
      context,
      language,
      normalizedSurfaceText: normalizeIdentityText(surfaceText),
      normalizedContext: normalizeText(context),
    };

    const duplicate = this.activeBatch.candidates.find(
      (candidate) => candidate.id !== candidateId
        && duplicateFingerprint(candidate) === duplicateFingerprint(edited),
    );
    if (duplicate) {
      throw new Error(
        "This edit would duplicate another staged candidate. Keep one candidate and discard the other instead.",
      );
    }

    const nextCandidates = [...this.activeBatch.candidates];
    nextCandidates[index] = edited;
    this.activeBatch = {
      ...this.activeBatch,
      candidates: await this.classify(nextCandidates),
    };
    return cloneResult(this.activeBatch);
  }

  async discardCandidates(candidateIds: readonly string[]): Promise<BatchCaptureResult | null> {
    if (!this.activeBatch) throw new Error("No staged batch is active.");

    const requestedIds = new Set(candidateIds);
    const knownIds = new Set(this.activeBatch.candidates.map((candidate) => candidate.id));
    for (const candidateId of requestedIds) {
      if (!knownIds.has(candidateId)) throw new Error(`Unknown staged candidate: ${candidateId}`);
    }

    if (requestedIds.size === 0) return cloneResult(this.activeBatch);

    const remaining = this.activeBatch.candidates.filter(
      (candidate) => !requestedIds.has(candidate.id),
    );
    if (remaining.length === 0) {
      this.activeBatch = null;
      return null;
    }

    this.activeBatch = {
      ...this.activeBatch,
      candidates: remaining,
    };
    return cloneResult(this.activeBatch);
  }

  async commit(request: BatchCommitRequest): Promise<BatchCommitResult> {
    if (!this.activeBatch) throw new Error("No staged batch is active.");

    const requestedIds = [...new Set(request.candidateIds)];
    const candidatesById = new Map(
      this.activeBatch.candidates.map((candidate) => [candidate.id, candidate]),
    );
    const selected = requestedIds.map((candidateId) => {
      const candidate = candidatesById.get(candidateId);
      if (!candidate) throw new Error(`Unknown staged candidate: ${candidateId}`);
      return candidate;
    });

    const entries: CaptureBatchEntry[] = selected.map((candidate) => ({
      draft: {
        text: candidate.surfaceText,
        context: candidate.context,
        language: candidate.language,
        source: candidate.source,
        capturedAt: candidate.capturedAt,
      },
      resolutionLexicalUnitId: request.resolutions?.[candidate.id],
    }));

    let outcomes;
    try {
      outcomes = await this.repository.captureBatch(entries);
    } catch (error) {
      try {
        await this.refreshActiveBatch();
      } catch {
        // Preserve the repository failure as the authoritative commit result.
        // Background recovery may retry reclassification before returning control
        // to the staged review UI.
      }
      throw error;
    }
    const committed: BatchCommitResult["committed"] = [];
    const unchangedCandidateIds: string[] = [];
    let newUnits = 0;
    let evidenceAdded = 0;

    outcomes.forEach((outcome, index) => {
      const candidateId = selected[index]!.id;
      if (outcome.kind === "unchanged") {
        unchangedCandidateIds.push(candidateId);
        return;
      }

      committed.push({ candidateId, item: outcome.item });
      if (outcome.kind === "new-unit") {
        newUnits += 1;
      } else {
        evidenceAdded += 1;
      }
    });

    const selectedIds = new Set(requestedIds);
    const remaining = this.activeBatch.candidates.filter(
      (candidate) => !selectedIds.has(candidate.id),
    );

    let warning: string | undefined;
    if (remaining.length === 0) {
      this.activeBatch = null;
    } else {
      // captureBatch() resolving is the irreversible corpus-commit boundary.
      // Consume selected staged candidates before any best-effort refresh so a
      // transient post-commit read failure can never masquerade as an uncommitted
      // import or re-offer already committed evidence as pending work.
      this.activeBatch = {
        ...this.activeBatch,
        candidates: remaining,
      };

      try {
        this.activeBatch = {
          ...this.activeBatch,
          candidates: await this.classify(remaining),
        };
      } catch (error) {
        warning = `Corpus import completed, but remaining staged evidence could not be reclassified: ${error instanceof Error ? error.message : "staged refresh failed."} Use Refresh staged before relying on the remaining disposition labels.`;
      }
    }

    return {
      committed,
      unchangedCandidateIds,
      remainingCandidateIds: this.activeBatch?.candidates.map((candidate) => candidate.id) ?? [],
      summary: {
        newUnits,
        evidenceAdded,
        unchanged: unchangedCandidateIds.length,
        needsReview: this.activeBatch?.candidates.filter(
          (candidate) => candidate.disposition === "needs-review",
        ).length ?? 0,
      },
      warning,
    };
  }

  async refreshActiveBatch(): Promise<BatchCaptureResult | null> {
    if (!this.activeBatch) return null;

    this.activeBatch = {
      ...this.activeBatch,
      candidates: await this.classify(this.activeBatch.candidates),
    };
    return cloneResult(this.activeBatch);
  }

  private async classify(
    candidates: readonly BatchCaptureCandidate[],
  ): Promise<BatchCaptureCandidate[]> {
    const corpus = await this.repository.list();
    const canonicalOwners = new Map<string, string>();
    const observedOwners = new Map<string, Set<string>>();
    const evidenceOwners = new Map<string, Set<string>>();

    for (const item of corpus) {
      const unit = item.lexicalUnit;
      canonicalOwners.set(unit.contentKey, unit.id);

      for (const occurrence of item.occurrences) {
        const observedKey = `${normalizeLanguage(unit.language)}::${occurrence.normalizedSurfaceText}`;
        const observed = observedOwners.get(observedKey) ?? new Set<string>();
        observed.add(unit.id);
        observedOwners.set(observedKey, observed);

        const evidenceKey = occurrenceEvidenceFingerprint(
          unit.language,
          occurrence.surfaceText,
          occurrence.context,
          occurrence.source,
        );
        const owners = evidenceOwners.get(evidenceKey) ?? new Set<string>();
        owners.add(unit.id);
        evidenceOwners.set(evidenceKey, owners);
      }
    }

    return candidates.map((candidate) => {
      const matchingIds = new Set<string>();
      const directOwner = canonicalOwners.get(
        makeContentKey(candidate.surfaceText, candidate.language),
      );
      if (directOwner) matchingIds.add(directOwner);

      const observedKey = `${candidate.language}::${candidate.normalizedSurfaceText}`;
      for (const owner of observedOwners.get(observedKey) ?? []) {
        matchingIds.add(owner);
      }

      const exactEvidenceOwners = evidenceOwners.get(
        occurrenceEvidenceFingerprint(
          candidate.language,
          candidate.surfaceText,
          candidate.context,
          candidate.source,
        ),
      ) ?? new Set<string>();

      const matchingLexicalUnitIds = [...matchingIds].sort();
      let disposition: CandidateDisposition;

      if (exactEvidenceOwners.size === 1) {
        // A unique exact occurrence match is stronger evidence than an ambiguous
        // surface-form match. Re-accepting it must remain a no-op.
        disposition = "already-represented";
      } else if (exactEvidenceOwners.size > 1 || matchingLexicalUnitIds.length > 1) {
        disposition = "needs-review";
      } else if (matchingLexicalUnitIds.length === 1) {
        disposition = "repeated-evidence";
      } else {
        disposition = "new";
      }

      return {
        ...candidate,
        disposition,
        matchingLexicalUnitIds,
      };
    });
  }
}
