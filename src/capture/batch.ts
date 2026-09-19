import { makeContentKey, normalizeIdentityText, normalizeText } from "../core/normalize";
import type { CaptureSource, CollectedItem } from "../core/types";
import type { CaptureBatchEntry, CaptureRepository } from "../storage/repository";

export type CandidateDisposition =
  | "new"
  | "already-represented"
  | "repeated-evidence"
  | "needs-review";

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

export interface BatchCommitResult {
  committed: Array<{
    candidateId: string;
    item: CollectedItem;
  }>;
  unchangedCandidateIds: string[];
  remainingCandidateIds: string[];
}

function normalizedLanguage(language: string): string {
  return language.trim().toLowerCase() || "und";
}

function sourceFingerprint(source: CaptureSource): string {
  return [source.kind, source.adapter, source.url, source.title].join("\u0000");
}

function metadataFingerprint(metadata: BatchAdapterMetadata | undefined): string {
  if (!metadata) return "";
  return JSON.stringify(
    Object.fromEntries(Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right))),
  );
}

function duplicateFingerprint(candidate: BatchCaptureEvidence): string {
  return [
    normalizedLanguage(candidate.language),
    normalizeIdentityText(candidate.surfaceText),
    normalizeText(candidate.context),
    sourceFingerprint(candidate.source),
    metadataFingerprint(candidate.adapterMetadata),
  ].join("\u0000");
}

function occurrenceEvidenceFingerprint(
  language: string,
  surfaceText: string,
  context: string,
  source: CaptureSource,
): string {
  return [
    normalizedLanguage(language),
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
        language: normalizedLanguage(value.language),
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
        id: `${normalizedBatchId}:${String(uniqueCandidates.length + 1).padStart(4, "0")}`,
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
      candidates,
    };

    return cloneResult(this.activeBatch);
  }

  discard(): void {
    this.activeBatch = null;
  }

  async commit(request: BatchCommitRequest): Promise<BatchCommitResult> {
    if (!this.activeBatch) throw new Error("No staged batch is active.");

    const requestedIds = [...new Set(request.candidateIds)];
    const candidatesById = new Map(
      this.activeBatch.candidates.map((candidate) => [candidate.id, candidate]),
    );
    const selected = await this.classify(requestedIds.map((candidateId) => {
      const candidate = candidatesById.get(candidateId);
      if (!candidate) throw new Error(`Unknown staged candidate: ${candidateId}`);
      return candidate;
    }));

    const unchangedCandidateIds: string[] = [];
    const entries: CaptureBatchEntry[] = [];
    const mutationCandidateIds: string[] = [];

    for (const candidate of selected) {
      if (candidate.disposition === "already-represented") {
        unchangedCandidateIds.push(candidate.id);
        continue;
      }

      let targetLexicalUnitId: string | undefined;

      if (candidate.disposition === "repeated-evidence") {
        targetLexicalUnitId = candidate.matchingLexicalUnitIds[0];
      } else if (candidate.disposition === "needs-review") {
        const resolution = request.resolutions?.[candidate.id];
        if (!resolution || !candidate.matchingLexicalUnitIds.includes(resolution)) {
          throw new Error(
            `Candidate ${candidate.id} needs an explicit matching lexical-unit resolution.`,
          );
        }
        targetLexicalUnitId = resolution;
      }

      entries.push({
        draft: {
          text: candidate.surfaceText,
          context: candidate.context,
          language: candidate.language,
          source: candidate.source,
          capturedAt: candidate.capturedAt,
        },
        targetLexicalUnitId,
      });
      mutationCandidateIds.push(candidate.id);
    }

    const items = entries.length > 0
      ? await this.repository.captureBatch(entries)
      : [];

    const committed = mutationCandidateIds.map((candidateId, index) => ({
      candidateId,
      item: items[index]!,
    }));

    const selectedIds = new Set(requestedIds);
    const remaining = this.activeBatch.candidates.filter(
      (candidate) => !selectedIds.has(candidate.id),
    );

    if (remaining.length === 0) {
      this.activeBatch = null;
    } else {
      this.activeBatch = {
        ...this.activeBatch,
        candidates: await this.classify(remaining),
      };
    }

    return {
      committed,
      unchangedCandidateIds,
      remainingCandidateIds: this.activeBatch?.candidates.map((candidate) => candidate.id) ?? [],
    };
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
        const observedKey = `${normalizedLanguage(unit.language)}::${occurrence.normalizedSurfaceText}`;
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

      if (matchingLexicalUnitIds.length > 1 || exactEvidenceOwners.size > 1) {
        disposition = "needs-review";
      } else if (exactEvidenceOwners.size === 1) {
        disposition = "already-represented";
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
