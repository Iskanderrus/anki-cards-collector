import { describe, expect, it } from "vitest";
import {
  DEFAULT_ONBOARDING_STATE,
  ONBOARDING_VERSION,
  normalizeOnboardingState,
} from "./onboarding";

describe("onboarding preference", () => {
  it("treats missing or malformed state as first run", () => {
    expect(normalizeOnboardingState(undefined)).toEqual(DEFAULT_ONBOARDING_STATE);
    expect(normalizeOnboardingState("done")).toEqual(DEFAULT_ONBOARDING_STATE);
    expect(normalizeOnboardingState({ dismissed: "yes" })).toEqual({
      version: ONBOARDING_VERSION,
      dismissed: false,
    });
  });

  it("preserves a deliberately dismissed introduction", () => {
    expect(normalizeOnboardingState({ version: 1, dismissed: true })).toEqual({
      version: 1,
      dismissed: true,
    });
  });

  it("keeps newer preference versions conservative without reopening onboarding", () => {
    expect(normalizeOnboardingState({ version: 3, dismissed: true })).toEqual({
      version: 3,
      dismissed: true,
    });
  });
});
