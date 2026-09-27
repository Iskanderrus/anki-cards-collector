import { describe, expect, it } from "vitest";
import type { CollectedItem, Occurrence, ReviewStatus } from "../core/types";
import {
  deriveLearningStudyContent,
  learningStudyContentSignature,
} from "./policy";
import {
  deriveLearningValueDecision,
  reconcileLearningValueBaselines,
} from "./value-decision";

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
): { before: CollectedItem; after: CollectedItem } {
  const before = item(
    "aunque",
    [{
      id: "first",
      surfaceText: "aunque",
      context: "Aunque llueva, voy a caminar por el parque esta tarde.",
      minute: 0,
    }],
    options,
  );
  const after: CollectedItem = {
    ...before,
    lexicalUnit: { ...before.lexicalUnit },
    occurrences: [
      ...before.occurrences,
      occurrence(before.lexicalUnit.id, {
        id: "repeat",
        surfaceText: "aunque",
        context: "Aunque llueva, voy a caminar por el parque esta tarde.",
        minute: 1,
      }),
    ],
  };
  return { before, after };
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
  ])("describes a cold/current useful %s snapshot as Study without inventing history", (_name, value) => {
    expect(deriveLearningStudyContent(value).proposal.recommended).toBe(true);
    expect(deriveLearningValueDecision({ item: value })).toMatchObject({
      kind: "study",
      reasonCode: "current-useful-evidence",
    });
  });

  it("can describe first useful evidence when a real empty before-state is supplied", () => {
    const current = item("aunque", [{
      id: "first",
      surfaceText: "aunque",
      context: "Aunque llueva, voy a caminar por el parque esta tarde.",
    }]);
    const previous: CollectedItem = {
      lexicalUnit: { ...current.lexicalUnit },
      occurrences: [],
    };

    expect(deriveLearningValueDecision({ item: current, previousItem: previous })).toMatchObject({
      kind: "study",
      reasonCode: "first-useful-evidence",
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

  it("rejects a cross-identity comparison before a weak-current archive early return", () => {
    const weakCurrent = item("aunque", [{
      id: "weak",
      surfaceText: "aunque",
      context: "aunque",
    }], { id: "unit-a" });
    const otherIdentity = item("aunque", [{
      id: "other",
      surfaceText: "aunque",
      context: "Aunque llueva, voy a caminar por el parque esta tarde.",
    }], { id: "unit-b" });

    expect(() => deriveLearningValueDecision({
      item: weakCurrent,
      previousItem: otherIdentity,
    })).toThrow("within one lexical unit");
  });

  it("treats an equivalent repeat as evidence only when the real before-state is supplied", () => {
    const { before, after } = equivalentRepeat();

    expect(deriveLearningValueDecision({ item: after, previousItem: before })).toMatchObject({
      kind: "evidence-only",
      reasonCode: "effective-study-content-unchanged",
    });
  });

  it("does not treat occurrence count alone as extra study burden", () => {
    const { before, after } = equivalentRepeat();

    expect(after.occurrences).toHaveLength(2);
    expect(deriveLearningValueDecision({ item: after, previousItem: before }).kind)
      .toBe("evidence-only");
  });

  it("does not fabricate Evidence only from a cold multi-occurrence snapshot", () => {
    const { after } = equivalentRepeat();

    expect(deriveLearningValueDecision({ item: after })).toMatchObject({
      kind: "study",
      reasonCode: "current-useful-evidence",
    });
  });

  it("recommends Improve when stronger selected context changes the effective proposal", () => {
    const previous = item(
      "tener ganas de",
      [{
        id: "weak",
        surfaceText: "tener ganas de",
        context: "tener ganas de",
        minute: 0,
      }],
      { note: "feel like doing something" },
    );
    const improved: CollectedItem = {
      ...previous,
      lexicalUnit: { ...previous.lexicalUnit },
      occurrences: [
        ...previous.occurrences,
        occurrence(previous.lexicalUnit.id, {
          id: "strong",
          surfaceText: "tener ganas de",
          context: "Después del trabajo solemos decir tener ganas de caminar por el centro tranquilo.",
          minute: 1,
        }),
      ],
    };

    const previousSelection = deriveLearningStudyContent(previous).proposal.occurrenceSelection!;
    const currentSelection = deriveLearningStudyContent(improved).proposal.occurrenceSelection!;

    expect(currentSelection.occurrence.id).toBe("strong");
    expect(currentSelection.score).toBeGreaterThan(previousSelection.score);
    expect(deriveLearningValueDecision({ item: improved, previousItem: previous })).toMatchObject({
      kind: "improve",
      reasonCode: "selected-evidence-improved",
    });
  });

  it("recommends Improve when an explicit learner note turns weak evidence into usable study content", () => {
    const before = item("aunque", [{
      id: "weak",
      surfaceText: "aunque",
      context: "aunque",
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
    const before = item(
      "aunque",
      [{
        id: "first",
        surfaceText: "aunque",
        context: "Aunque llueva, voy a caminar.",
        minute: 0,
      }],
      { id: "stable-unit", status: "ready", ankiNoteId: 4242 },
    );
    const after: CollectedItem = {
      ...before,
      lexicalUnit: { ...before.lexicalUnit, status: "inbox" },
      occurrences: [
        ...before.occurrences,
        occurrence(before.lexicalUnit.id, {
          id: "better",
          surfaceText: "aunque",
          context: "Aunque llueva, voy a caminar por el parque durante toda la tarde.",
          minute: 1,
        }),
      ],
    };

    const result = deriveLearningValueDecision({ item: after, previousItem: before });
    expect(["study", "improve"]).toContain(result.kind);
    expect(after.lexicalUnit).toMatchObject({
      id: "stable-unit",
      ankiNoteId: 4242,
    });
  });

  it("preserves Ready as user state for an equivalent repeat", () => {
    const { before, after } = equivalentRepeat({ status: "ready" });

    expect(deriveLearningValueDecision({ item: after, previousItem: before }).kind)
      .toBe("evidence-only");
    expect(after.lexicalUnit.status).toBe("ready");
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
    const first = item(
      "banco",
      [{
        id: "financial",
        surfaceText: "banco",
        context: "El banco aprobó el préstamo para nuestra casa ayer.",
      }],
      { id: "unit-a", note: "financial institution" },
    );
    const second = item(
      "banco",
      [{
        id: "river",
        surfaceText: "banco",
        context: "banco",
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

  it("returns identical snapshot decisions for equivalent restored corpus state", () => {
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

  it("uses the actual loaded before-state for delayed older-but-stronger evidence", () => {
    const before = item("policy evidence", [{
      id: "existing",
      surfaceText: "policy evidence",
      context: "policy evidence appears in a controlled sentence with enough surrounding words.",
      capturedAt: "2026-09-27T10:01:00Z",
    }], { status: "ready" });
    const after: CollectedItem = {
      ...before,
      lexicalUnit: { ...before.lexicalUnit, status: "inbox" },
      occurrences: [
        ...before.occurrences,
        occurrence(before.lexicalUnit.id, {
          id: "delayed-strong",
          surfaceText: "policy evidence",
          context: "Before lunch the policy evidence appears in a controlled sentence with enough surrounding words today.",
          capturedAt: "2026-09-27T10:00:00Z",
        }),
      ],
    };

    const baselines = reconcileLearningValueBaselines([before], [after], {});
    expect(baselines[before.lexicalUnit.id]).toBe(before);
    expect(learningStudyContentSignature(before))
      .not.toBe(learningStudyContentSignature(after));
    expect(deriveLearningValueDecision({
      item: after,
      previousItem: baselines[before.lexicalUnit.id],
    })).toMatchObject({
      kind: "improve",
      reasonCode: "selected-evidence-improved",
    });
  });

  it("does not use UUID order as mutation order for same-timestamp multi-evidence loads", () => {
    const before = item("policy evidence", [{
      id: "existing",
      surfaceText: "policy evidence",
      context: "policy evidence appears in a controlled sentence with enough surrounding words.",
      capturedAt: "2026-09-27T10:01:00Z",
    }], { status: "ready" });
    const sameTimestamp = "2026-09-27T10:00:00Z";
    const after: CollectedItem = {
      ...before,
      lexicalUnit: { ...before.lexicalUnit, status: "inbox" },
      occurrences: [
        ...before.occurrences,
        occurrence(before.lexicalUnit.id, {
          id: "zzzz-random",
          surfaceText: "policy evidence",
          context: "Before lunch the policy evidence appears in a controlled sentence with enough surrounding words today.",
          capturedAt: sameTimestamp,
        }),
        occurrence(before.lexicalUnit.id, {
          id: "aaaa-random",
          surfaceText: "policy evidence",
          context: "Today the policy evidence appears in another useful sentence.",
          capturedAt: sameTimestamp,
        }),
      ],
    };

    const baselines = reconcileLearningValueBaselines([before], [after], {});
    expect(baselines[before.lexicalUnit.id]?.occurrences.map((value) => value.id))
      .toEqual(["existing"]);
    expect(deriveLearningValueDecision({
      item: after,
      previousItem: baselines[before.lexicalUnit.id],
    }).kind).toBe("improve");
  });

  it("retains a mutation baseline across status-only reloads", () => {
    const { before, after } = equivalentRepeat();
    const baselines = reconcileLearningValueBaselines([before], [after], {});
    const readyAfter: CollectedItem = {
      ...after,
      lexicalUnit: { ...after.lexicalUnit, status: "ready", updatedAt: at(2) },
    };

    const retained = reconcileLearningValueBaselines([after], [readyAfter], baselines);
    expect(retained[readyAfter.lexicalUnit.id]).toBe(before);
    expect(deriveLearningValueDecision({
      item: readyAfter,
      previousItem: retained[readyAfter.lexicalUnit.id],
    }).kind).toBe("evidence-only");
  });
});
