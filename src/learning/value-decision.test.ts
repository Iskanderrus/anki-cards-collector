import { describe, expect, it } from "vitest";
import type { CollectedItem, Occurrence, ReviewStatus } from "../core/types";
import { deriveLearningStudyContent } from "./policy";
import { deriveLearningValueDecision } from "./value-decision";

interface OccurrenceInput {
  id: string;
  surfaceText: string;
  context: string;
  minute?: number;
  capturedAt?: string;
  sourceUrl?: string;
}

const at = (minute: number) =>
  `2026-09-27T10:${String(minute).padStart(2, "0")}:00Z`;

function occurrence(unitId: string, input: OccurrenceInput): Occurrence {
  const capturedAt = input.capturedAt ?? at(input.minute ?? 0);
  return {
    id: input.id,
    lexicalUnitId: unitId,
    surfaceText: input.surfaceText,
    normalizedSurfaceText: input.surfaceText.toLocaleLowerCase(),
    context: input.context,
    source: {
      kind: "web",
      adapter: "generic-web",
      url: input.sourceUrl ?? "https://example.com/article",
      title: "Example",
    },
    capturedAt,
  };
}

function item(
  canonicalText: string,
  occurrences: OccurrenceInput[],
  options: {
    id?: string;
    note?: string;
    status?: ReviewStatus;
    language?: string;
    ankiNoteId?: number;
  } = {},
): CollectedItem {
  const id = options.id ?? "unit-1";
  const language = options.language ?? "es";
  return {
    lexicalUnit: {
      id,
      contentKey: `${language}::${canonicalText.toLocaleLowerCase()}`,
      canonicalText,
      normalizedCanonicalText: canonicalText.toLocaleLowerCase(),
      language,
      note: options.note ?? "",
      status: options.status ?? "inbox",
      createdAt: "2026-09-27T09:00:00Z",
      updatedAt: "2026-09-27T09:00:00Z",
      ...(options.ankiNoteId === undefined ? {} : { ankiNoteId: options.ankiNoteId }),
    },
    occurrences: occurrences.map((value) => occurrence(id, value)),
  };
}

function equivalentRepeat(
  options: { status?: ReviewStatus } = {},
): CollectedItem {
  const value = item(
    "aunque",
    [{
      id: "first",
      surfaceText: "aunque",
      context: "Aunque llueva, voy a caminar por el parque esta tarde.",
      minute: 0,
    }],
    options,
  );
  return {
    ...value,
    lexicalUnit: { ...value.lexicalUnit },
    occurrences: [
      ...value.occurrences,
      occurrence(value.lexicalUnit.id, {
        id: "repeat",
        surfaceText: "aunque",
        context: "Aunque llueva, voy a caminar por el parque esta tarde.",
        minute: 1,
      }),
    ],
  };
}

describe("learning-value decision", () => {
  it.each([
    [
      "word",
      item("aunque", [{
        id: "word",
        surfaceText: "aunque",
        context: "Aunque llueva, voy a caminar por el parque esta tarde.",
      }]),
    ],
    [
      "chunk",
      item("tener ganas de", [{
        id: "chunk",
        surfaceText: "tener ganas de",
        context: "Después del trabajo solemos decir tener ganas de caminar por el centro tranquilo.",
      }]),
    ],
    [
      "sentence",
      item("quiero aprender español porque pienso vivir allí pronto", [{
        id: "sentence",
        surfaceText: "quiero aprender español porque pienso vivir allí pronto",
        context: "Hoy quiero aprender español porque pienso vivir allí pronto con mi familia.",
      }]),
    ],
  ])("classifies a useful %s corpus as Study", (_name, value) => {
    expect(deriveLearningStudyContent(value).proposal.recommended).toBe(true);
    expect(deriveLearningValueDecision({ item: value })).toMatchObject({
      kind: "study",
      reasonCode: "current-useful-evidence",
    });
  });

  it("fails closed when ACCP-005 cannot construct useful study content", () => {
    const weak = item("aunque", [{
      id: "weak",
      surfaceText: "aunque",
      context: "aunque",
    }]);

    expect(deriveLearningStudyContent(weak).proposal.recommended).toBe(false);
    expect(deriveLearningValueDecision({ item: weak })).toEqual({
      kind: "archive",
      label: "Archive for now",
      reasonCode: "current-evidence-not-studyable",
      reason: "Current evidence does not support a useful study card yet.",
    });
  });

  it("uses a learner note as current corpus state without inventing note history", () => {
    const withNote = item(
      "aunque",
      [{
        id: "weak",
        surfaceText: "aunque",
        context: "aunque",
      }],
      { note: "although / even though" },
    );

    expect(deriveLearningStudyContent(withNote).proposal.recommended).toBe(true);
    expect(deriveLearningValueDecision({ item: withNote }).kind).toBe("study");
  });

  it("classifies an equivalent repeated occurrence as Evidence only from the corpus alone", () => {
    const repeated = equivalentRepeat();

    expect(repeated.occurrences).toHaveLength(2);
    expect(deriveLearningValueDecision({ item: repeated })).toMatchObject({
      kind: "evidence-only",
      reasonCode: "effective-study-content-unchanged",
    });
  });

  it("keeps Evidence only stable across a side-panel/browser recreation", () => {
    const persisted = equivalentRepeat();
    const beforeReopen = deriveLearningValueDecision({ item: persisted });
    const afterReopen = deriveLearningValueDecision({
      item: structuredClone(persisted),
    });

    expect(beforeReopen).toEqual(afterReopen);
    expect(afterReopen.kind).toBe("evidence-only");
  });

  it("ignores workflow-only status changes when deriving learning value", () => {
    const inbox = equivalentRepeat({ status: "inbox" });
    const ready: CollectedItem = {
      ...inbox,
      lexicalUnit: {
        ...inbox.lexicalUnit,
        status: "ready",
        updatedAt: at(5),
      },
    };

    expect(deriveLearningValueDecision({ item: inbox }))
      .toEqual(deriveLearningValueDecision({ item: ready }));
  });

  it("classifies strictly stronger selected evidence as Improve against the other studyable evidence", () => {
    const improved = item(
      "tener ganas de",
      [
        {
          id: "baseline",
          surfaceText: "tener ganas de",
          context: "tener ganas de",
          minute: 1,
        },
        {
          id: "strong",
          surfaceText: "tener ganas de",
          context: "Después del trabajo solemos decir tener ganas de caminar por el centro tranquilo.",
          minute: 0,
        },
      ],
      { note: "feel like doing something" },
    );

    const selected = deriveLearningStudyContent(improved).proposal.occurrenceSelection!;
    expect(selected.occurrence.id).toBe("strong");
    expect(deriveLearningValueDecision({ item: improved })).toMatchObject({
      kind: "improve",
      reasonCode: "selected-evidence-improved",
    });
  });

  it("does not require the stronger evidence to have the newest capturedAt", () => {
    const improved = item(
      "policy evidence",
      [
        {
          id: "existing",
          surfaceText: "policy evidence",
          context: "policy evidence appears in a controlled sentence with enough surrounding words.",
          capturedAt: "2026-09-27T10:01:00Z",
        },
        {
          id: "delayed-strong",
          surfaceText: "policy evidence",
          context: "Before lunch the policy evidence appears in a controlled sentence with enough surrounding words today.",
          capturedAt: "2026-09-27T10:00:00Z",
        },
      ],
    );

    expect(deriveLearningStudyContent(improved).proposal.occurrenceSelection?.occurrence.id)
      .toBe("delayed-strong");
    expect(deriveLearningValueDecision({ item: improved }).kind).toBe("improve");
  });

  it("keeps the learning-value kind stable when same-timestamp UUID tie order changes", () => {
    const sameTimestamp = "2026-09-27T10:00:00Z";
    const build = (firstStrongId: string, secondStrongId: string) => item(
      "policy evidence",
      [
        {
          id: "existing",
          surfaceText: "policy evidence",
          context: "policy evidence appears in a controlled sentence with enough surrounding words.",
          capturedAt: "2026-09-27T10:01:00Z",
        },
        {
          id: firstStrongId,
          surfaceText: "policy evidence",
          context: "Before lunch the policy evidence appears in a controlled sentence with enough surrounding words today.",
          capturedAt: sameTimestamp,
        },
        {
          id: secondStrongId,
          surfaceText: "policy evidence",
          context: "Today the policy evidence appears in another useful controlled sentence.",
          capturedAt: sameTimestamp,
        },
      ],
    );

    const first = build("zzzz-random", "aaaa-random");
    const swapped = build("aaaa-random", "zzzz-random");

    expect(deriveLearningValueDecision({ item: first }).kind).toBe("improve");
    expect(deriveLearningValueDecision({ item: swapped }).kind).toBe("improve");
  });

  it("falls back to Study when the only alternative evidence is not independently studyable", () => {
    const corpus = item("aunque", [
      {
        id: "strong",
        surfaceText: "aunque",
        context: "Aunque llueva, voy a caminar por el parque esta tarde.",
        minute: 0,
      },
      {
        id: "weak",
        surfaceText: "aunque",
        context: "aunque",
        minute: 1,
      },
    ]);

    expect(deriveLearningValueDecision({ item: corpus }).kind).toBe("study");
  });

  it("does not call equal-quality but materially different study content an improvement", () => {
    const corpus = item("aunque", [
      {
        id: "first",
        surfaceText: "aunque",
        context: "Aunque llueva, voy a caminar por el parque esta tarde.",
        minute: 0,
      },
      {
        id: "second",
        surfaceText: "aunque",
        context: "Aunque nieve, voy a caminar por el centro esta mañana.",
        minute: 1,
      },
    ]);

    const current = deriveLearningStudyContent(corpus).proposal.occurrenceSelection!;
    const alternative = deriveLearningStudyContent({
      ...corpus,
      occurrences: corpus.occurrences.filter(
        (value) => value.id !== current.occurrence.id,
      ),
    }).proposal.occurrenceSelection!;

    expect(current.score).toBe(alternative.score);
    expect(deriveLearningValueDecision({ item: corpus }).kind).toBe("study");
  });

  it("keeps one lexical and Anki identity while evidence quality changes", () => {
    const corpus = item(
      "aunque",
      [
        {
          id: "first",
          surfaceText: "aunque",
          context: "Aunque llueva, voy a caminar.",
          minute: 1,
        },
        {
          id: "better",
          surfaceText: "aunque",
          context: "Aunque llueva, voy a caminar por el parque durante toda la tarde.",
          minute: 0,
        },
      ],
      { id: "stable-unit", status: "inbox", ankiNoteId: 4242 },
    );

    expect(deriveLearningValueDecision({ item: corpus }).kind).not.toBe("archive");
    expect(corpus.lexicalUnit).toMatchObject({
      id: "stable-unit",
      ankiNoteId: 4242,
    });
  });

  it("derives same-canonical identities independently", () => {
    const financial = item(
      "banco",
      [{
        id: "financial",
        surfaceText: "banco",
        context: "El banco aprobó el préstamo para nuestra casa ayer.",
      }],
      { id: "bank-financial", note: "financial institution" },
    );
    const river = item(
      "banco",
      [{
        id: "river",
        surfaceText: "banco",
        context: "banco",
      }],
      { id: "bank-river" },
    );

    expect(financial.lexicalUnit.normalizedCanonicalText)
      .toBe(river.lexicalUnit.normalizedCanonicalText);
    expect(deriveLearningValueDecision({ item: financial }).kind).toBe("study");
    expect(deriveLearningValueDecision({ item: river }).kind).toBe("archive");
  });

  it("evaluates split-style units from their own occurrence subsets", () => {
    const source = item(
      "banco",
      [{
        id: "financial",
        surfaceText: "banco",
        context: "El banco aprobó el préstamo para nuestra casa ayer.",
      }],
      { id: "unit-a", note: "financial institution" },
    );
    const created = item(
      "banco",
      [{
        id: "river",
        surfaceText: "banco",
        context: "banco",
      }],
      { id: "unit-b" },
    );

    expect(deriveLearningValueDecision({ item: source }).kind).toBe("study");
    expect(deriveLearningValueDecision({ item: created }).kind).toBe("archive");
  });

  it("recomputes a merge-style survivor from the persisted merged corpus", () => {
    const survivor = item(
      "banco",
      [
        {
          id: "financial",
          surfaceText: "banco",
          context: "El banco aprobó el préstamo para nuestra casa ayer.",
          minute: 0,
        },
        {
          id: "merged",
          surfaceText: "banco",
          context: "El banco confirmó la transferencia después de revisar todos los datos.",
          minute: 1,
        },
      ],
      { id: "survivor", note: "financial institution" },
    );

    expect(deriveLearningValueDecision({ item: survivor }).kind).not.toBe("archive");
  });

  it("returns identical decisions for an equivalent restored corpus state", () => {
    const original = equivalentRepeat({ status: "ready" });
    const restored = structuredClone(original);

    expect(deriveLearningValueDecision({ item: restored }))
      .toEqual(deriveLearningValueDecision({ item: original }));
  });

  it("changes only when learning-relevant persisted corpus state changes", () => {
    const single = item("aunque", [{
      id: "first",
      surfaceText: "aunque",
      context: "Aunque llueva, voy a caminar por el parque esta tarde.",
    }]);
    const repeated = equivalentRepeat();

    expect(deriveLearningValueDecision({ item: single }).kind).toBe("study");
    expect(deriveLearningValueDecision({ item: repeated }).kind).toBe("evidence-only");
  });
});
