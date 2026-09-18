import { describe, expect, it } from "vitest";
import type { CollectedItem } from "../core/types";
import { classifyLearningUnit, proposeLearningCard } from "./policy";

function item(
  expression: string,
  context: string,
  options: { note?: string; occurrences?: number } = {},
): CollectedItem {
  const occurrences = Array.from({ length: options.occurrences ?? 1 }, (_, index) => ({
    id: `occ-${index + 1}`,
    lexicalUnitId: "unit-1",
    context,
    source: {
      kind: "web" as const,
      adapter: "generic-web",
      url: "https://example.com",
      title: "Example",
    },
    capturedAt: `2026-09-19T10:0${index}:00Z`,
  }));

  return {
    lexicalUnit: {
      id: "unit-1",
      contentKey: `es::${expression.toLocaleLowerCase()}`,
      displayText: expression,
      normalizedText: expression.toLocaleLowerCase(),
      language: "es",
      note: options.note ?? "",
      status: "inbox",
      createdAt: "2026-09-19T10:00:00Z",
      updatedAt: "2026-09-19T10:00:00Z",
    },
    occurrences,
  };
}

describe("learning-card policy", () => {
  it("classifies words, chunks, and sentences deterministically", () => {
    expect(classifyLearningUnit("aunque")).toBe("word");
    expect(classifyLearningUnit("tener ganas de")).toBe("chunk");
    expect(classifyLearningUnit("Aunque llueva, voy a caminar porque necesito aire.")).toBe("sentence");
  });

  it("prefers contextual production for a multi-word expression", () => {
    const proposal = proposeLearningCard(
      item("tener ganas de", "Hoy tengo ganas de salir a caminar por el centro."),
    );

    expect(proposal).toMatchObject({
      unitKind: "chunk",
      cardKind: "context-production",
      prompt: "Hoy […] salir a caminar por el centro.",
      answer: "tener ganas de",
      recommended: true,
    });
  });

  it("does not invent a meaning for a word without a learner note", () => {
    const proposal = proposeLearningCard(
      item("aunque", "Aunque llueva, voy a caminar."),
    );

    expect(proposal.cardKind).toBe("context-recognition");
    expect(proposal.answer).toBe("Aunque llueva, voy a caminar.");
    expect(proposal.reason).toContain("No meaning is generated automatically");
  });

  it("uses a learner note as the explicit review target for a single word", () => {
    const proposal = proposeLearningCard(
      item("aunque", "Aunque llueva, voy a caminar.", { note: "although / even though" }),
    );

    expect(proposal.answer).toContain("although / even though");
    expect(proposal.answer).toContain("Aunque llueva");
    expect(proposal.recommended).toBe(true);
  });

  it("blocks a sentence that has no broader context and no learner note", () => {
    const sentence = "Aunque llueva, voy a caminar porque necesito un poco de aire fresco.";
    const proposal = proposeLearningCard(item(sentence, sentence));

    expect(proposal.unitKind).toBe("sentence");
    expect(proposal.recommended).toBe(false);
    expect(proposal.warning).toContain("learner note");
  });

  it("blocks captures that are too broad for one retrieval target", () => {
    const expression = Array.from({ length: 26 }, (_, index) => `palabra${index}`).join(" ");
    const proposal = proposeLearningCard(item(expression, expression, { note: "Long passage" }));

    expect(proposal.recommended).toBe(false);
    expect(proposal.reason).toContain("too broad");
  });

  it("uses repeated encounters as evidence without proposing another card", () => {
    const proposal = proposeLearningCard(
      item("tener ganas de", "Hoy tengo ganas de salir a caminar por el centro.", { occurrences: 3 }),
    );

    expect(proposal.reason).toContain("Seen 3 times");
  });
});
