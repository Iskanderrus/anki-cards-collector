import { describe, expect, it } from "vitest";
import {
  clearStagedRefreshWarning,
  type StagedImportResult,
} from "./staged-review";

describe("clearStagedRefreshWarning", () => {
  it("clears only the staged-refresh warning and preserves an unrelated Queue warning", () => {
    const result: StagedImportResult = {
      summary: {
        newUnits: 1,
        evidenceAdded: 0,
        unchanged: 0,
        needsReview: 0,
      },
      stagedWarning: "Use Refresh staged before relying on remaining dispositions.",
      queueWarning: "Reload Queue to see the committed corpus state.",
    };

    expect(clearStagedRefreshWarning(result)).toEqual({
      summary: result.summary,
      stagedWarning: undefined,
      queueWarning: "Reload Queue to see the committed corpus state.",
    });
  });

  it("leaves an absent import result absent", () => {
    expect(clearStagedRefreshWarning(null)).toBeNull();
  });
});
