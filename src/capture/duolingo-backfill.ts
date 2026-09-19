import { normalizeIdentityText, normalizeText } from "../core/normalize";
import type { BatchCaptureEvidence } from "./batch";
import type { CaptureSource } from "../core/types";

export const DUOLINGO_BACKFILL_ADAPTER_ID = "duolingo-visible-backfill";

const CANDIDATE_SELECTORS = [
  "[data-test*='challenge'] [lang]",
  "[data-test*='sentence']",
  "[data-test*='tap-token']",
  "[data-test*='word-bank'] [data-test*='token']",
  "[data-test*='challenge'] [data-test*='word']",
];

const CONTEXT_SELECTORS = [
  "[data-test*='challenge']",
  "[data-test*='review']",
  "[data-test*='lesson']",
  "main",
];

function isDuolingoHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "duolingo.com" || normalized.endsWith(".duolingo.com");
}

export function supportsDuolingoVisibleBackfill(
  location: Pick<Location, "hostname">,
  allowFixture = false,
): boolean {
  return isDuolingoHostname(location.hostname) || allowFixture;
}

function isVisible(element: Element): boolean {
  if (element.closest("[hidden], [aria-hidden='true']")) return false;

  const htmlElement = element as HTMLElement;
  if (typeof htmlElement.checkVisibility === "function") {
    return htmlElement.checkVisibility({
      checkOpacity: true,
      checkVisibilityCSS: true,
    });
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }

  return element.getClientRects().length > 0;
}

function candidateText(element: Element): string {
  return normalizeText(element.textContent ?? "").slice(0, 240);
}

function isUsefulCandidate(text: string): boolean {
  if (!text || text.length > 240) return false;
  return /\p{L}/u.test(text);
}

function nearestContext(element: Element): string {
  for (const selector of CONTEXT_SELECTORS) {
    const container = element.parentElement?.closest(selector);
    if (!container) continue;

    const context = normalizeText(container.textContent ?? "").slice(0, 800);
    if (context) return context;
  }

  return normalizeText(element.parentElement?.textContent ?? element.textContent ?? "").slice(0, 800);
}

function source(location: Location, title: string): CaptureSource {
  return {
    kind: "duolingo",
    adapter: DUOLINGO_BACKFILL_ADAPTER_ID,
    url: location.href,
    title,
  };
}

export function duolingoEvidenceFingerprint(evidence: BatchCaptureEvidence): string {
  return [
    evidence.language.trim().toLowerCase() || "und",
    normalizeIdentityText(evidence.surfaceText),
    normalizeText(evidence.context),
    evidence.source.adapter,
    evidence.source.url,
  ].join("\u0000");
}

export function collectVisibleDuolingoEvidence(
  document: Document,
  location: Location,
  title: string,
  language: string,
  capturedAt = new Date().toISOString(),
  allowFixture = false,
): BatchCaptureEvidence[] {
  if (!supportsDuolingoVisibleBackfill(location, allowFixture)) return [];

  const collected: BatchCaptureEvidence[] = [];
  const fingerprints = new Set<string>();

  for (const selector of CANDIDATE_SELECTORS) {
    for (const element of document.querySelectorAll(selector)) {
      if (!isVisible(element)) continue;

      const surfaceText = candidateText(element);
      if (!isUsefulCandidate(surfaceText)) continue;

      const evidence: BatchCaptureEvidence = {
        surfaceText,
        context: nearestContext(element),
        language: language.trim().toLowerCase() || "und",
        source: source(location, title),
        capturedAt,
        adapterMetadata: {
          extractor: "visible-dom",
          selector,
        },
      };
      const fingerprint = duolingoEvidenceFingerprint(evidence);
      if (fingerprints.has(fingerprint)) continue;

      fingerprints.add(fingerprint);
      collected.push(evidence);
    }
  }

  return collected;
}
