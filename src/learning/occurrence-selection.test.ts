import { describe, expect, it } from "vitest";
import type { Occurrence } from "../core/types";
import {
  buildContextualPrompt,
  selectBestOccurrence,
} from "./occurrence-selection";

function occurrence(
  id: string,
  surfaceText: string,
  context: string,
  capturedAt: string,
): Occurrence {
  return {
    id,
    lexicalUnitId: "unit-1",
    surfaceText,
    normalizedSurfaceText: surfaceText.toLocaleLowerCase(),
    context,
    source: {
      kind: "web",
      adapter: "generic-web",
      url: \`https://example.com/\${id}\`,
      title: id,
    },
    capturedAt,
  };
}

describe("best occurrence selection", () => {
  it("lets a stronger older context beat a weaker newer capture", () => {
    const older = occurrence(
      "old",
      "tengo ganas de",
      "Hoy tengo ganas de salir a caminar por el centro.",
      "2026-09-19T10:00:00Z",
    );
    const newer = occurrence(
      "new",
      "tengo ganas de",
      "tengo ganas de",
      "2026-09-19T11:00:00Z",
    );

    const selection = selectBestOccurrence(
      [older, newer],
      { preferContextualCloze: true },
    );

    expect(selection?.occurrence.id).toBe("old");
    expect(selection?.selectedNumber).toBe(1);
    expect(selection?.occurrenceCount).toBe(2);
    expect(selection?.breakdown.clozeUsability).toBeGreaterThan(0);
    expect(selection?.reason).toContain("usable contextual blank");
  });

  it("uses recency only when quality scores are tied", () => {
    const older = occurrence(
      "old",
      "aunque",
      "Aunque llueva, salgo a caminar.",
      "2026-09-19T10:00:00Z",
    );
    const newer = occurrence(
      "new",
      "aunque",
      "Aunque nieve, salgo a caminar.",
      "2026-09-19T11:00:00Z",
    );

    const selection = selectBestOccurrence([older, newer]);

    expect(selection?.occurrence.id).toBe("new");
    expect(selection?.recencyTieBreak).toBe(true);
    expect(selection?.reason).toContain("newer capture won the tie");
  });

  it("is stable regardless of input order when score and timestamp tie", () => {
    const first = occurrence(
      "a",
      "aunque",
      "Aunque llueva, salgo a caminar.",
      "2026-09-19T10:00:00Z",
    );
    const second = occurrence(
      "b",
      "aunque",
      "Aunque nieve, salgo a caminar.",
      "2026-09-19T10:00:00Z",
    );

    expect(selectBestOccurrence([second, first])?.occurrence.id).toBe("a");
    expect(selectBestOccurrence([first, second])?.occurrence.id).toBe("a");
  });

  it("requires the observed surface to be present for a contextual blank", () => {
    expect(
      buildContextualPrompt(
        "Mañana quiero salir a caminar por el centro.",
        "tengo ganas de",
      ),
    ).toBeNull();

    const noTarget = occurrence(
      "missing",
      "tengo ganas de",
      "Mañana quiero salir a caminar por el centro.",
      "2026-09-19T10:00:00Z",
    );
    const selection = selectBestOccurrence(
      [noTarget],
      { preferContextualCloze: true },
    );

    expect(selection?.breakdown.targetInContext).toBe(false);
    expect(selection?.breakdown.clozeUsability).toBeLessThan(0);
  });

  it("penalizes obvious URL/noise-heavy context", () => {
    const clean = occurrence(
      "clean",
      "aunque",
      "Aunque llueva, todavía quiero caminar por el parque.",
      "2026-09-19T10:00:00Z",
    );
    const noisy = occurrence(
      "noisy",
      "aunque",
      "https://example.com/?q=aunque !!!!!! aunque ####",
      "2026-09-19T11:00:00Z",
    );

    const selection = selectBestOccurrence([noisy, clean]);

    expect(selection?.occurrence.id).toBe("clean");
    expect(
      selectBestOccurrence([noisy])?.breakdown.noisePenalty,
    ).toBeLessThan(0);
  });

  it("returns null for an item without occurrences", () => {
    expect(selectBestOccurrence([])).toBeNull();
  });
});
