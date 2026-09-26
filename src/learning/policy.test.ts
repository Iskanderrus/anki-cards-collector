import { describe, expect, it } from "vitest";
import type { CollectedItem, Occurrence } from "../core/types";
import {
  classifyLearningUnit,
  learningStudyContentSignature,
  proposeLearningCard,
} from "./policy";

interface OccurrenceInput {
  id: string;
  surfaceText: string;
  context: string;
  capturedAt: string;
  sourceUrl?: string;
}

function occurrence(input: OccurrenceInput): Occurrence {
  return {
    id: input.id,
    lexicalUnitId: "unit-1",
    surfaceText: input.surfaceText,
    normalizedSurfaceText: input.surfaceText.toLocaleLowerCase(),
    context: input.context,
    source: {
      kind: "web",
      adapter: "generic-web",
      url: input.sourceUrl ?? `https://example.com/${input.id}`,
      title: input.id,
    },
    capturedAt: input.capturedAt,
  };
}

function item(
  canonicalText: string,
  occurrences: OccurrenceInput[],
  options: { note?: string; status?: "inbox" | "ready" | "archived" } = {},
): CollectedItem {
  return {
    lexicalUnit: {
      id: "unit-1",
      contentKey: `es::${canonicalText.toLocaleLowerCase()}`,
      canonicalText,
      normalizedCanonicalText: canonicalText.toLocaleLowerCase(),
      language: "es",
      note: options.note ?? "",
      status: options.status ?? "inbox",
      createdAt: "2026-09-19T09:00:00Z",
      updatedAt: "2026-09-19T09:00:00Z",
    },
    occurrences: occurrences.map(occurrence),
  };
}

const at = (minute: number) => `2026-09-19T10:${String(minute).padStart(2, "0")}:00Z`;

describe("learning-card policy v2", () => {
  it("classifies the canonical learning target deterministically", () => {
    expect(classifyLearningUnit("aunque")).toBe("word");
    expect(classifyLearningUnit("tener ganas de")).toBe("chunk");
    expect(classifyLearningUnit("aunque llueva voy a caminar porque necesito aire")).toBe("sentence");
  });

  const wordCases = [
    {
      name: "isolated word + learner note",
      value: item(
        "aunque",
        [{ id: "isolated-note", surfaceText: "aunque", context: "", capturedAt: at(0) }],
        { note: "although / even though" },
      ),
      expected: {
        reasonCode: "word-note-recognition",
        cardKind: "context-recognition",
        prompt: "aunque",
        answer: "although / even though",
        recommended: true,
      },
    },
    {
      name: "isolated word without learner note",
      value: item(
        "aunque",
        [{ id: "isolated-empty", surfaceText: "aunque", context: "", capturedAt: at(0) }],
      ),
      expected: {
        reasonCode: "reject-word-evidence",
        warningCode: "add-word-evidence",
        cardKind: "context-recognition",
        prompt: "aunque",
        answer: "",
        recommended: false,
      },
    },
    {
      name: "word with strong context",
      value: item(
        "aunque",
        [{
          id: "word-strong",
          surfaceText: "aunque",
          context: "Aunque llueva, voy a caminar por el parque esta tarde.",
          capturedAt: at(0),
        }],
      ),
      expected: {
        reasonCode: "word-context-recognition",
        cardKind: "context-recognition",
        prompt: "aunque",
        answer: "Context: Aunque llueva, voy a caminar por el parque esta tarde.",
        recommended: true,
      },
    },
    {
      name: "word with weak/noisy context",
      value: item(
        "aunque",
        [{
          id: "word-noisy",
          surfaceText: "aunque",
          context: "https://example.com/?q=aunque !!! aunque ####",
          capturedAt: at(0),
        }],
      ),
      expected: {
        reasonCode: "reject-word-evidence",
        warningCode: "add-word-evidence",
        cardKind: "context-recognition",
        recommended: false,
      },
    },
  ] as const;

  for (const testCase of wordCases) {
    it(testCase.name, () => {
      expect(proposeLearningCard(testCase.value)).toMatchObject(testCase.expected);
    });
  }

  it("uses contextual production only for a chunk with strong usable context", () => {
    const proposal = proposeLearningCard(item(
      "tener ganas de",
      [{
        id: "chunk-strong",
        surfaceText: "tengo ganas de",
        context: "Hoy tengo ganas de salir a caminar por el centro.",
        capturedAt: at(0),
      }],
    ));

    expect(proposal).toMatchObject({
      unitKind: "chunk",
      cardKind: "context-production",
      reasonCode: "chunk-context-production",
      prompt: "Hoy […] salir a caminar por el centro.",
      answer: "tengo ganas de\n\nCanonical: tener ganas de",
      recommended: true,
    });
    expect(proposal.occurrenceSelection?.occurrence.id).toBe("chunk-strong");
  });

  it("does not silently turn a weak chunk context into production", () => {
    const proposal = proposeLearningCard(item(
      "tener ganas de",
      [{
        id: "chunk-weak",
        surfaceText: "tengo ganas de",
        context: "tengo ganas de",
        capturedAt: at(0),
      }],
    ));

    expect(proposal).toMatchObject({
      unitKind: "chunk",
      cardKind: "context-recognition",
      reasonCode: "reject-chunk-context",
      warningCode: "improve-chunk-context",
      prompt: "tengo ganas de",
      recommended: false,
    });
  });

  it("falls back to learner-note recognition for a weak chunk context", () => {
    const proposal = proposeLearningCard(item(
      "tener ganas de",
      [{
        id: "chunk-note",
        surfaceText: "tengo ganas de",
        context: "tengo ganas de",
        capturedAt: at(0),
      }],
      { note: "feel like doing something" },
    ));

    expect(proposal).toMatchObject({
      cardKind: "context-recognition",
      reasonCode: "chunk-note-recognition",
      prompt: "tengo ganas de",
      recommended: true,
    });
    expect(proposal.answer).toBe(
      "feel like doing something\n\nCanonical: tener ganas de\n\nContext: tengo ganas de",
    );
  });

  it("keeps canonical identity distinct from the selected observed form", () => {
    const proposal = proposeLearningCard(item(
      "tener ganas de",
      [{
        id: "chunk-inflected",
        surfaceText: "tengo ganas de",
        context: "Hoy tengo ganas de salir a caminar por el centro.",
        capturedAt: at(0),
      }],
      { note: "feel like" },
    ));

    expect(proposal.prompt).toBe("Hoy […] salir a caminar por el centro.");
    expect(proposal.answer).toBe(
      "tengo ganas de\n\nCanonical: tener ganas de\n\nfeel like",
    );
    expect(proposal.occurrenceSelection?.occurrence.surfaceText).toBe("tengo ganas de");
  });

  it("allows sentence recall only when the retrieval target is bounded by useful context", () => {
    const sentence = "aunque llueva voy a caminar porque necesito aire";
    const proposal = proposeLearningCard(item(
      sentence,
      [{
        id: "sentence-bounded",
        surfaceText: sentence,
        context: `Hoy digo ${sentence} antes de cenar mañana`,
        capturedAt: at(0),
      }],
    ));

    expect(proposal).toMatchObject({
      unitKind: "sentence",
      cardKind: "context-recall",
      reasonCode: "sentence-context-recall",
      prompt: "Hoy digo […] antes de cenar mañana",
      answer: sentence,
      recommended: true,
    });
  });

  it("rejects a sentence without a useful retrieval target", () => {
    const sentence = "aunque llueva voy a caminar porque necesito aire";
    const proposal = proposeLearningCard(item(
      sentence,
      [{
        id: "sentence-unbounded",
        surfaceText: sentence,
        context: sentence,
        capturedAt: at(0),
      }],
    ));

    expect(proposal).toMatchObject({
      unitKind: "sentence",
      cardKind: "sentence-review",
      reasonCode: "reject-sentence-target",
      warningCode: "narrow-sentence-target",
      prompt: sentence,
      answer: "",
      recommended: false,
    });
  });

  it("uses an explicit learner note when sentence context is not a bounded recall cue", () => {
    const sentence = "aunque llueva voy a caminar porque necesito aire";
    const proposal = proposeLearningCard(item(
      sentence,
      [{
        id: "sentence-note",
        surfaceText: sentence,
        context: sentence,
        capturedAt: at(0),
      }],
      { note: "Practice this contrast with the previous sentence." },
    ));

    expect(proposal).toMatchObject({
      cardKind: "sentence-review",
      reasonCode: "sentence-note-review",
      answer: "Practice this contrast with the previous sentence.",
      recommended: true,
    });
  });

  it("rejects an overly broad canonical target", () => {
    const canonical = Array.from({ length: 26 }, (_, index) => `palabra${index}`).join(" ");
    const proposal = proposeLearningCard(item(
      canonical,
      [{ id: "broad", surfaceText: canonical, context: canonical, capturedAt: at(0) }],
      { note: "Long passage" },
    ));

    expect(proposal).toMatchObject({
      reasonCode: "reject-too-broad",
      warningCode: "too-broad",
      recommended: false,
    });
  });

  it("lets a stronger older occurrence beat a weaker newer occurrence", () => {
    const proposal = proposeLearningCard(item(
      "tener ganas de",
      [
        {
          id: "older-strong",
          surfaceText: "tengo ganas de",
          context: "Hoy tengo ganas de salir a caminar por el centro.",
          capturedAt: at(0),
        },
        {
          id: "newer-weak",
          surfaceText: "tengo ganas de",
          context: "tengo ganas de",
          capturedAt: at(5),
        },
      ],
    ));

    expect(proposal.occurrenceSelection?.occurrence.id).toBe("older-strong");
    expect(proposal.prompt).toBe("Hoy […] salir a caminar por el centro.");
    expect(proposal.reasonCode).toBe("chunk-context-production");
  });

  it("uses deterministic recency tie-breaking when occurrence quality is equal", () => {
    const proposal = proposeLearningCard(item(
      "aunque",
      [
        {
          id: "older",
          surfaceText: "aunque",
          context: "Aunque llueva, salgo a caminar por el parque.",
          capturedAt: at(0),
        },
        {
          id: "newer",
          surfaceText: "aunque",
          context: "Aunque nieve, salgo a caminar por el parque.",
          capturedAt: at(5),
        },
      ],
    ));

    expect(proposal.occurrenceSelection?.occurrence.id).toBe("newer");
    expect(proposal.occurrenceSelection?.recencyTieBreak).toBe(true);
    expect(proposal.answer).toBe(
      "Context: Aunque nieve, salgo a caminar por el parque.",
    );
  });

  it("changes the study-content signature when newly stronger evidence changes exported content", () => {
    const before = item(
      "tener ganas de",
      [{
        id: "weak",
        surfaceText: "tengo ganas de",
        context: "tengo ganas de",
        capturedAt: at(5),
      }],
      { note: "feel like", status: "ready" },
    );
    const after: CollectedItem = {
      ...before,
      occurrences: [
        ...before.occurrences,
        occurrence({
          id: "strong",
          surfaceText: "tengo ganas de",
          context: "Hoy tengo ganas de salir a caminar por el centro.",
          capturedAt: at(0),
        }),
      ],
    };

    expect(proposeLearningCard(before).cardKind).toBe("context-recognition");
    expect(proposeLearningCard(after).cardKind).toBe("context-production");
    expect(learningStudyContentSignature(after)).not.toBe(
      learningStudyContentSignature(before),
    );
  });

  it("keeps a one-proposal budget even when repeated encounters accumulate", () => {
    const value = item(
      "tener ganas de",
      Array.from({ length: 3 }, (_, index) => ({
        id: `repeat-${index}`,
        surfaceText: "tengo ganas de",
        context: "Hoy tengo ganas de salir a caminar por el centro.",
        capturedAt: at(index),
        sourceUrl: "https://example.com/shared",
      })),
    );

    const proposal = proposeLearningCard(value);
    expect(proposal.cardKind).toBe("context-production");
    expect(proposal.occurrenceSelection?.occurrenceCount).toBe(3);
    expect(proposal.reason).toContain("Repeated encounters remain one learning target");
  });
});
