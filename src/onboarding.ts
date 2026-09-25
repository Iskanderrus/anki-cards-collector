export const ONBOARDING_STORAGE_KEY = "collectorOnboarding";
export const ONBOARDING_VERSION = 1;

export interface OnboardingState {
  version: number;
  dismissed: boolean;
}

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  version: ONBOARDING_VERSION,
  dismissed: false,
};

export function normalizeOnboardingState(value: unknown): OnboardingState {
  if (!value || typeof value !== "object") return DEFAULT_ONBOARDING_STATE;

  const raw = value as Partial<OnboardingState>;
  const version = Number(raw.version);
  return {
    version: Number.isInteger(version) && version > 0 ? version : ONBOARDING_VERSION,
    dismissed: raw.dismissed === true,
  };
}

export async function loadOnboardingState(): Promise<OnboardingState> {
  const stored = await chrome.storage.local.get(ONBOARDING_STORAGE_KEY);
  return normalizeOnboardingState(stored[ONBOARDING_STORAGE_KEY]);
}

export async function dismissOnboarding(): Promise<void> {
  await chrome.storage.local.set({
    [ONBOARDING_STORAGE_KEY]: {
      version: ONBOARDING_VERSION,
      dismissed: true,
    } satisfies OnboardingState,
  });
}
