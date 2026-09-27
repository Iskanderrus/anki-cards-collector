import { describe, expect, it } from "vitest";
import type { CollectedItem, Occurrence, ReviewStatus } from "../core/types";
import { deriveLearningStudyContent } from "./policy";
import {
  deriveLearningValueDecision,
  previousEvidenceItem,
} from "./value-decision";

interface OccurrenceInput {
  id: string;
  surfaceText: string;
  context: string;
  minute: number;
  sourceUrl?: string;
}

const at = (minute: number) =>
  `2026-09-27T10:${String(minute).padStart(2, "0")}:00Z`;

function occurrence(unitId: string, input: OccurrenceInput): Occurrence {
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
    capturedAt: at(input.minute),
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

describe("learning-value decision", () => {
  it.each([
    [
      "word",
      item("aunque", [{
        id: "word",
        surfaceText: "aunque",
        context: "Aunque llueva, voy a caminar por el parque esta tarde.",
        minute: 0,
      }]),
    ],
    [
      "chunk",
      item("tener ganas de", [{
        id: "chunk",
        surfaceText: "tener ganas de",
        context: "Después del trabajo solemos decir tener ganas de caminar por el centro tranquilo.",
        minute: 0,
      }]),
    ],
    [
      "sentence",
      item("quiero aprender español porque pienso vivir allí pronto", [{
        id: "sentence",
        surfaceText: "quiero aprender español porque pienso vivir allí pronto",
        context: "Hoy quiero aprender español porque pienso vivir allí pronto con mi familia.",
        minute: 0,
      }]),
    ],
  ])("recommends Study for first useful %s evidence", (_name, value) => {
    expect(deriveLearningStudyContent(value).proposal.recommended).toBe(true);
    expect(deriveLearningValueDecision({ item: value })).toMatchObject({
      kind: "study",
      reasonCode: "first-useful-evidence",
    });
  });

  it("fails closed when ACCP-005 cannot construct useful study content", () => {
    const weak = item("aunque", [{
      id: "weak",
      surfaceText: "aunque",
      context: "aunque",
      minute: 0,
    }]);

    expect(deriveLearningStudyContent(weak).proposal.recommended).toBe(false);
    expect(deriveLearningValueDecision({ item: weak })).toEqual({
      kind: "archive",
      label: "Archive for now",
      reasonCode: "current-evidence-not-studyable",
      reason: "Current evidence does not support a useful study card yet.",
    });
  });

  it("treats an equivalent repeat as evidence only", () => {
    const repeated = item("aunque", [
      {
        id: "first",
        surfaceText: "aunque",
        context: "Aunque llueva, voy a caminar por el parque esta tarde.",
        minute: 0,
      },
      {
        id: "repeat",
        surfaceText: "aunque",
        context: "Aunque llueva, voy a caminar por el parque esta tarde.",
        minute: 1,
      },
    ]);

    expect(deriveLearningValueDecision({ item: repeated })).toMatchObject({
      kind: "evidence-only",
      reasonCode: "effective-study-content-unchanged",
    });
  });

  it("does not treat occurrence count alone as extra study burden", () => {
    const once = item("aunque", [{
      id: "first",
      surfaceText: "aunque",
      context: "Aunque llueva, voy a caminar por el parque esta tarde.",
      minute: 0,
    }]);
    const twice = {
      ...once,
      occurrences: [
        ...once.occurrences,
        occurrence(once.lexicalUnit.id, {
          id: "repeat",
          surfaceText: "aunque",
          context: "Aunque llueva, voy a caminar por el parque esta tarde.",
          minute: 1,
        }),
      ],
    };

    expect(twice.occurrences).toHaveLength(2);
    expect(deriveLearningValueDecision({ item: twice }).kind).toBe("evidence-only");
  });

  it("recommends Improve when stronger selected context changes the effective proposal", () => {
    const improved = item(
      "tener ganas de",
      [
        {
          id: "weak",
          surfaceText: "tener ganas de",
          context: "tener ganas de",
          minute: 0,
        },
        {
          id: "strong",
          surfaceText: "tener ganas de",
          context: "Después del trabajo solemos decir tener ganas de caminar por el centro tranquilo.",
          minute: 1,
        },
      ],
      { note: "feel like doing something" },
    );

    const previous = previousEvidenceItem(improved)!;
    const previousSelection = deriveLearningStudyContent(previous).proposal.occurrenceSelection!;
    const currentSelection = deriveLearningStudyContent(improved).proposal.occurrenceSelection!;

    expect(currentSelection.occurrence.id).toBe("strong");
    expect(currentSelection.score).toBeGreaterThan(previousSelection.score);
    expect(deriveLearningValueDecision({ item: improved })).toMatchObject({
      kind: "improve",
      reasonCode: "selected-evidence-improved",
    });
  });

  it("recommends Improve when an explicit learner note turns weak evidence into usable study content", () => {
    const before = item("aunque", [{
      id: "weak",
      surfaceText: "aunque",
      context: "aunque",
      minute: 0,
    }]);
    const after = {
      ...before,
      lexicalUnit: {
        ...before.lexicalUnit,
        note: "although / even though",
        updatedAt: at(1),
      },
    };

    expect(deriveLearningStudyContent(before).proposal.recommended).toBe(false);
    expect(deriveLearningStudyContent(after).proposal.recommended).toBe(true);
    expect(deriveLearningValueDecision({ item: after, previousItem: before })).toMatchObject({
      kind: "improve",
      reasonCode: "new-evidence-makes-studyable",
    });
  });

  it("keeps one lexical and Anki identity when evidence improves", () => {
    const value = item(
      "aunque",
      [
        {
          id: "first",
          surfaceText: "aunque",
          context: "Aunque llueva, voy a caminar.",
          minute: 0,
        },
        {
          id: "better",
          surfaceText: "aunque",
          context: "Aunque llueva, voy a caminar por el parque durante toda la tarde.",
          minute: 1,
        },
      ],
      { id: "stable-unit", status: "ready", ankiNoteId: 4242 },
    );

    const result = deriveLearningValueDecision({ item: value });
    expect(["study", "improve"]).toContain(result.kind);
    expect(value.lexicalUnit).toMatchObject({
      id: "stable-unit",
      ankiNoteId: 4242,
    });
  });

  it("preserves Ready as user state for an equivalent repeat", () => {
    const ready = item(
      "aunque",
      [
        {
          id: "first",
          surfaceText: "aunque",
          context: "Aunque llueva, voy a caminar por el parque esta tarde.",
          minute: 0,
        },
        {
          id: "repeat",
          surfaceText: "aunque",
          context: "Aunque llueva, voy a caminar por el parque esta tarde.",
          minute: 1,
        },
      ],
      { status: "ready" },
    );

    expect(deriveLearningValueDecision({ item: ready }).kind).toBe("evidence-only");
    expect(ready.lexicalUnit.status).toBe("ready");
  });

  it("derives same-canonical identities independently", () => {
    const financial = item(
      "banco",
      [{
        id: "financial",
        surfaceText: "banco",
        context: "El banco aprobó el préstamo para nuestra casa ayer.",
        minute: 0,
      }],
      { id: "bank-financial", note: "financial institution" },
    );
    const river = item(
      "banco",
      [{
        id: "river",
        surfaceText: "banco",
        context: "banco",
        minute: 0,
      }],
      { id: "bank-river" },
    );

    expect(financial.lexicalUnit.normalizedCanonicalText)
      .toBe(river.lexicalUnit.normalizedCanonicalText);
    expect(deriveLearningValueDecision({ item: financial }).kind).toBe("study");
    expect(deriveLearningValueDecision({ item: river }).kind).toBe("archive");
  });

  it("evaluates split-style units from their own occurrence subsets", () => {
    const first = item(
      "banco",
      [{
        id: "financial",
        surfaceText: "banco",
        context: "El banco aprobó el préstamo para nuestra casa ayer.",
        minute: 0,
      }],
      { id: "unit-a", note: "financial institution" },
    );
    const second = item(
      "banco",
      [{
        id: "river",
        surfaceText: "banco",
        context: "banco",
        minute: 1,
      }],
      { id: "unit-b" },
    );

    expect(deriveLearningValueDecision({ item: first }).kind).toBe("study");
    expect(deriveLearningValueDecision({ item: second }).kind).toBe("archive");
  });

  it("recomputes a merge-style survivor from the merged evidence", () => {
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

  it("returns identical decisions for equivalent restored corpus state", () => {
    const original = item("aunque", [
      {
        id: "first",
        surfaceText: "aunque",
        context: "Aunque llueva, voy a caminar por el parque esta tarde.",
        minute: 0,
      },
      {
        id: "repeat",
        surfaceText: "aunque",
        context: "Aunque llueva, voy a caminar por el parque esta tarde.",
        minute: 1,
      },
    ]);
    const restored = JSON.parse(JSON.stringify(original)) as CollectedItem;

    expect(deriveLearningValueDecision({ item: restored }))
      .toEqual(deriveLearningValueDecision({ item: original }));
  });

  it("does not compare learning value across lexical identities", () => {
    const current = item("banco", [{
      id: "current",
      surfaceText: "banco",
      context: "El banco aprobó el préstamo para nuestra casa ayer.",
      minute: 1,
    }], { id: "unit-a", note: "financial institution" });
    const previous = item("banco", [{
      id: "previous",
      surfaceText: "banco",
      context: "El banco aprobó el préstamo para nuestra casa ayer.",
      minute: 0,
    }], { id: "unit-b", note: "financial institution" });

    expect(() => deriveLearningValueDecision({ item: current, previousItem: previous }))
      .toThrow("within one lexical unit");
  });
});
