import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BatchCaptureEvidence, BatchSourceAdapter } from "./batch";
import { BatchCapturePipeline } from "./batch";
import { CollectorDatabase } from "../storage/database";
import { CaptureRepository } from "../storage/repository";

function evidence(
  surfaceText: string,
  context: string,
  capturedAt = "2026-09-19T12:00:00.000Z",
): BatchCaptureEvidence {
  return {
    surfaceText,
    context,
    language: "he",
    capturedAt,
    source: {
      kind: "web",
      adapter: "fake-visible-source",
      url: "https://example.com/lesson",
      title: "Visible lesson",
    },
  };
}

describe("BatchCapturePipeline", () => {
  let database: CollectorDatabase;
  let repository: CaptureRepository;
  let pipeline: BatchCapturePipeline;

  beforeEach(() => {
    database = new CollectorDatabase(`collector-batch-test-${crypto.randomUUID()}`);
    repository = new CaptureRepository(database);
    pipeline = new BatchCapturePipeline(repository);
  });

  afterEach(async () => {
    database.close();
    await database.delete();
  });

  it("stages dozens of candidates from a source adapter without mutating the corpus", async () => {
    const adapter: BatchSourceAdapter = {
      id: "fake-source",
      collect: () =>
        Array.from({ length: 64 }, (_, index) =>
          evidence(`מילה ${index + 1}`, `הקשר ${index + 1}`),
        ),
    };

    const staged = await pipeline.stageFromAdapter("session-64", adapter);

    expect(staged.candidates).toHaveLength(64);
    expect(staged.candidates[0]?.id).toBe("session-64:0001");
    expect(staged.candidates[63]?.id).toBe("session-64:0064");
    expect(staged.candidates.every((candidate) => candidate.disposition === "new")).toBe(true);
    expect(await repository.list()).toEqual([]);
  });

  it("collapses exact in-batch duplicates while keeping distinct context evidence", async () => {
    const staged = await pipeline.stageBatch("dedupe", [
      evidence("שלום", "שלום, דנה.", "2026-09-19T12:00:00.000Z"),
      evidence("  שלום ", "שלום, דנה.", "2026-09-19T12:01:00.000Z"),
      evidence("שלום", "שלום, יואב.", "2026-09-19T12:02:00.000Z"),
    ]);

    expect(staged.receivedCount).toBe(3);
    expect(staged.duplicatesCollapsed).toBe(1);
    expect(staged.candidates).toHaveLength(2);
    expect(staged.candidates.map((candidate) => candidate.id)).toEqual([
      "dedupe:0001",
      "dedupe:0002",
    ]);
    expect(staged.candidates[0]?.duplicateCount).toBe(2);
    expect(staged.candidates.map((candidate) => candidate.context)).toEqual([
      "שלום, דנה.",
      "שלום, יואב.",
    ]);
  });

  it("distinguishes already represented evidence from a new occurrence for the same form", async () => {
    await repository.capture({
      text: "שלום",
      context: "שלום, דנה.",
      language: "he",
      capturedAt: "2026-09-19T10:00:00.000Z",
      source: evidence("שלום", "שלום, דנה.").source,
    });

    const staged = await pipeline.stageBatch("existing", [
      evidence("שלום", "שלום, דנה."),
      evidence("שלום", "שלום, יואב."),
    ]);

    expect(staged.candidates.map((candidate) => candidate.disposition)).toEqual([
      "already-represented",
      "repeated-evidence",
    ]);

    const result = await pipeline.commit({
      candidateIds: staged.candidates.map((candidate) => candidate.id),
    });

    expect(result.unchangedCandidateIds).toEqual(["existing:0001"]);
    expect(result.committed.map((entry) => entry.candidateId)).toEqual(["existing:0002"]);
    expect((await repository.list())[0]?.occurrences).toHaveLength(2);
  });

  it("requires an explicit resolution when an observed form has multiple owners", async () => {
    const first = await repository.capture({
      text: "כתב",
      context: "הוא כתב מכתב.",
      language: "he",
      capturedAt: "2026-09-19T09:00:00.000Z",
      source: evidence("כתב", "הוא כתב מכתב.").source,
    });
    await repository.update(first.lexicalUnit.id, {
      canonicalText: "לכתוב",
      language: "he",
      note: "",
      occurrenceId: first.occurrences[0]!.id,
      surfaceText: "כתב",
      context: "הוא כתב מכתב.",
    });

    const second = await repository.capture({
      text: "כתיבה",
      context: "כתיבה היא מיומנות.",
      language: "he",
      capturedAt: "2026-09-19T09:05:00.000Z",
      source: evidence("כתיבה", "כתיבה היא מיומנות.").source,
    });
    await repository.update(second.lexicalUnit.id, {
      canonicalText: "כתיבה",
      language: "he",
      note: "",
      occurrenceId: second.occurrences[0]!.id,
      surfaceText: "כתב",
      context: "זה כתב ברור.",
    });

    const staged = await pipeline.stageBatch("ambiguous", [
      evidence("כתב", "כתב נוסף."),
    ]);
    const candidate = staged.candidates[0]!;

    expect(candidate.disposition).toBe("needs-review");
    expect(candidate.matchingLexicalUnitIds).toHaveLength(2);

    await expect(
      pipeline.commit({ candidateIds: [candidate.id] }),
    ).rejects.toThrow("needs an explicit matching lexical-unit resolution");

    await pipeline.commit({
      candidateIds: [candidate.id],
      resolutions: { [candidate.id]: first.lexicalUnit.id },
    });

    const updated = (await repository.list()).find(
      (item) => item.lexicalUnit.id === first.lexicalUnit.id,
    );
    expect(updated?.occurrences).toHaveLength(2);
  });

  it("commits only the selected subset and keeps the rest staged", async () => {
    const staged = await pipeline.stageBatch("partial", [
      evidence("אחד", "אחד כאן."),
      evidence("שתיים", "שתיים כאן."),
      evidence("שלוש", "שלוש כאן."),
    ]);

    const result = await pipeline.commit({
      candidateIds: [staged.candidates[1]!.id],
    });

    const corpus = await repository.list();
    expect(corpus).toHaveLength(1);
    expect(corpus[0]?.lexicalUnit.canonicalText).toBe("שתיים");
    expect(corpus[0]?.lexicalUnit.status).toBe("inbox");
    expect(result.remainingCandidateIds).toEqual(["partial:0001", "partial:0003"]);

    pipeline.discard();
    expect(pipeline.getActiveBatch()).toBeNull();
    expect(await repository.list()).toHaveLength(1);
  });

  it("reclassifies remaining candidates after a partial commit", async () => {
    const staged = await pipeline.stageBatch("reclassify", [
      evidence("בית", "זה בית גדול."),
      evidence("בית", "הבית קרוב."),
    ]);

    expect(staged.candidates.map((candidate) => candidate.disposition)).toEqual(["new", "new"]);

    await pipeline.commit({ candidateIds: [staged.candidates[0]!.id] });

    expect(pipeline.getActiveBatch()?.candidates[0]?.disposition).toBe("repeated-evidence");
  });

  it("revalidates a staged candidate against corpus changes before commit", async () => {
    const staged = await pipeline.stageBatch("stale", [
      evidence("מים", "אני שותה מים."),
    ]);

    expect(staged.candidates[0]?.disposition).toBe("new");

    await repository.capture({
      text: "מים",
      context: "אני שותה מים.",
      language: "he",
      capturedAt: "2026-09-19T12:01:00.000Z",
      source: evidence("מים", "אני שותה מים.").source,
    });

    const result = await pipeline.commit({
      candidateIds: [staged.candidates[0]!.id],
    });

    expect(result.committed).toEqual([]);
    expect(result.unchangedCandidateIds).toEqual(["stale:0001"]);
    expect((await repository.list())[0]?.occurrences).toHaveLength(1);
  });

  it("rolls back the whole repository batch on a commit failure", async () => {
    await expect(
      repository.captureBatch([
        {
          draft: {
            text: "לחם",
            context: "יש לחם על השולחן.",
            language: "he",
            capturedAt: "2026-09-19T13:00:00.000Z",
            source: evidence("לחם", "יש לחם על השולחן.").source,
          },
        },
        {
          draft: {
            text: "מים",
            context: "המים קרים.",
            language: "he",
            capturedAt: "2026-09-19T13:01:00.000Z",
            source: evidence("מים", "המים קרים.").source,
          },
          targetLexicalUnitId: "missing-unit",
        },
      ]),
    ).rejects.toThrow("Target lexical unit no longer exists");

    expect(await repository.list()).toEqual([]);
  });
});
