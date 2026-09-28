import {
  localCanonicalFormProvider,
  type CanonicalFormProvider,
  type CanonicalFormProviderInput,
  type CanonicalFormProviderResult,
} from "./canonical-form";
import { normalizeIdentityText } from "../core/normalize";

function e2eSuggestion(
  proposedCanonical: string,
  language = "es",
): CanonicalFormProviderResult {
  return {
    kind: "suggestions",
    suggestions: [{
      proposedCanonical,
      language,
      confidence: "high",
      category: "e2e-fixture",
      evidenceLabel: "Deterministic browser-test fixture.",
    }],
  };
}

/**
 * Browser-test-only canonical-form provider.
 * Kept in a dedicated module so production builds can dead-code-eliminate it.
 */
class E2eCanonicalFormProvider implements CanonicalFormProvider {
  private supersedeRequests = 0;
  private releaseSupersededRequest: ((result: CanonicalFormProviderResult) => void) | null = null;

  supports(language: string): boolean {
    return localCanonicalFormProvider.supports(language);
  }

  async suggest(input: CanonicalFormProviderInput): Promise<CanonicalFormProviderResult> {
    const observed = normalizeIdentityText(input.observedForm);

    if (observed === "providerunavailable") {
      throw new Error("Synthetic provider failure.");
    }

    if (observed === "delayform") {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 350));
      return e2eSuggestion("delaylemma");
    }

    if (observed === "supersedeform") {
      this.supersedeRequests += 1;
      if (this.supersedeRequests === 1) {
        return await new Promise<CanonicalFormProviderResult>((resolve) => {
          this.releaseSupersededRequest = resolve;
        });
      }

      const releaseSupersededRequest = this.releaseSupersededRequest;
      this.releaseSupersededRequest = null;
      globalThis.setTimeout(() => {
        releaseSupersededRequest?.(e2eSuggestion("oldlemma"));
      }, 100);
      return e2eSuggestion("newlemma");
    }

    return localCanonicalFormProvider.suggest(input);
  }
}

export function createE2eCanonicalFormProvider(): CanonicalFormProvider {
  return new E2eCanonicalFormProvider();
}
