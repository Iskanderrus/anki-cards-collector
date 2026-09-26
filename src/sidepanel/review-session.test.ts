import { describe, expect, it } from "vitest";
import { reconcileReviewSessionMerge } from "./review-session";

describe("reconcileReviewSessionMerge", () => {
  it("keeps the survivor at the current source position when it was already reviewed earlier", () => {
    expect(
      reconcileReviewSessionMerge(
        ["survivor", "reviewed-gap", "source", "next"],
        "source",
        "survivor",
        "survivor",
      ),
    ).toEqual(["reviewed-gap", "survivor", "next"]);
  });

  it("preserves the next unreviewed item when the surviving target was later in the snapshot", () => {
    expect(
      reconcileReviewSessionMerge(
        ["source", "next", "target", "tail"],
        "source",
        "target",
        "target",
      ),
    ).toEqual(["target", "next", "tail"]);
  });

  it("removes an earlier target when the source itself survives", () => {
    expect(
      reconcileReviewSessionMerge(
        ["target", "reviewed-gap", "source", "next"],
        "source",
        "target",
        "source",
      ),
    ).toEqual(["reviewed-gap", "source", "next"]);
  });

  it("replaces the only involved snapshot id when the source is outside the session", () => {
    expect(
      reconcileReviewSessionMerge(
        ["before", "target", "after"],
        "source-outside-session",
        "target",
        "source-outside-session",
      ),
    ).toEqual(["before", "source-outside-session", "after"]);
  });

  it("leaves an unrelated snapshot unchanged", () => {
    const ids = ["first", "second"];
    expect(
      reconcileReviewSessionMerge(ids, "source", "target", "source"),
    ).toBe(ids);
  });
});
