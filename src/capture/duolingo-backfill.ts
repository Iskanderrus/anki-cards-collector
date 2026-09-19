import { normalizeIdentityText, normalizeText } from "../core/normalize";
import type { BatchCaptureEvidence } from "./batch";
import type { CaptureSource } from "../core/types";

export const DUOLINGO_BACKFILL_ADAPTER_ID = "duolingo-visible-backfill";

const MAX_CANDIDATE_LENGTH = 240;

const CANDIDATE_SELECTORS = [
  "[data-test='hint-sentence']",
  "[data-test='hint-token']",
  "[data-test*='sentence']",
  "[data-test='challenge-tap-token']",
  "[data-test='challenge-tap-token-text']",
  "[data-test*='word-bank'] [data-test*='token']",
  "[data-test='stories-phrase']",
  "[data-test='stories-selectable-phrase']",
  "[data-test='stories-token']",
];

const SUPPORTED_STUDY_CONTEXT_SELECTORS = [
  "[data-test^='challenge-']",
  "[data-test^='review-']",
  "[data-test^='lesson-']",
  "[data-test^='stories-']",
];

const TARGET_SENTENCE_SELECTORS = [
  "[data-test='hint-sentence']",
  "[data-test*='sentence']",
  "[data-test='stories-phrase']",
  "[data-test='stories-selectable-phrase']",
  "[lang]",
];

const STUDY_CONTAINER_SELECTORS = [
  "[data-test*='challenge']",
  "[data-test*='review']",
  "[data-test*='lesson']",
  "main",
];

function isDuolingoHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "duolingo.com" || normalized.endsWith(".duolingo.com");
}

function hasSupportedStudyContext(document: Document): boolean {
  return SUPPORTED_STUDY_CONTEXT_SELECTORS.some((selector) =>
    [...document.querySelectorAll(selector)].some((element) => isVisible(element))
  );
}

export function supportsDuolingoVisibleBackfill(
  document: Document,
  location: Pick<Location, "hostname">,
  allowFixture = false,
): boolean {
  const allowedOrigin = isDuolingoHostname(location.hostname) || allowFixture;
  return allowedOrigin && hasSupportedStudyContext(document);
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
  return normalizeText(element.textContent ?? "");
}

function isUsefulCandidate(text: string): boolean {
  if (!text || text.length > MAX_CANDIDATE_LENGTH) return false;
  return /\p{L}/u.test(text);
}

function matchesConfiguredLanguage(element: Element, language: string): boolean {
  const configured = language.trim().toLowerCase();
  if (!configured || configured === "und") return true;

  const languageOwner = element.closest("[lang]");
  const declared = languageOwner?.getAttribute("lang")?.trim().toLowerCase();
  if (!declared) return false;

  const configuredBase = configured.split("-")[0];
  const declaredBase = declared.split("-")[0];
  return configuredBase === declaredBase;
}

function isWordBankElement(element: Element): boolean {
  return Boolean(
    element.closest("[data-test*='word-bank']")
    || element.matches("[data-test='challenge-tap-token'], [data-test='challenge-tap-token-text'], [data-test='hint-token'], [data-test='stories-token']"),
  );
}

function studyContainer(element: Element): Element | null {
  for (const selector of STUDY_CONTAINER_SELECTORS) {
    const container = element.parentElement?.closest(selector);
    if (container) return container;
  }
  return null;
}

function targetSentenceContext(
  element: Element,
  surfaceText: string,
  language: string,
): string {
  // A non-word-bank target element is itself the cleanest evidence. This avoids
  // concatenating Duolingo prompt text, answer choices, and control labels.
  if (!isWordBankElement(element)) {
    return surfaceText;
  }

  const container = studyContainer(element);
  if (!container) return surfaceText;

  for (const selector of TARGET_SENTENCE_SELECTORS) {
    for (const candidate of container.querySelectorAll(selector)) {
      if (candidate === element || isWordBankElement(candidate)) continue;
      if (!isVisible(candidate) || !matchesConfiguredLanguage(candidate, language)) continue;

      const text = candidateText(candidate);
      if (!isUsefulCandidate(text)) continue;
      return text;
    }
  }

  // A token with no reliably identifiable target sentence is still useful
  // evidence. Keeping only the token is safer than storing the whole challenge UI.
  return surfaceText;
}

function hasUsefulTargetLanguageDescendant(
  element: Element,
  language: string,
): boolean {
  for (const descendant of element.querySelectorAll("[lang]")) {
    if (!isVisible(descendant) || !matchesConfiguredLanguage(descendant, language)) continue;
    const text = candidateText(descendant);
    if (isUsefulCandidate(text)) return true;
  }
  return false;
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
  if (!supportsDuolingoVisibleBackfill(document, location, allowFixture)) return [];

  const collected: BatchCaptureEvidence[] = [];
  const fingerprints = new Set<string>();
  const explicitElements = new Set<Element>();

  function collectElement(element: Element, selector: string): void {
    if (!isVisible(element)) return;
    if (!matchesConfiguredLanguage(element, language)) return;

    const surfaceText = candidateText(element);
    if (!isUsefulCandidate(surfaceText)) return;

    const evidence: BatchCaptureEvidence = {
      surfaceText,
      context: targetSentenceContext(element, surfaceText, language),
      language: language.trim().toLowerCase() || "und",
      source: source(location, title),
      capturedAt,
      adapterMetadata: {
        extractor: "visible-dom",
        selector,
      },
    };
    const fingerprint = duolingoEvidenceFingerprint(evidence);
    if (fingerprints.has(fingerprint)) return;

    fingerprints.add(fingerprint);
    collected.push(evidence);
  }

  for (const selector of CANDIDATE_SELECTORS) {
    for (const element of document.querySelectorAll(selector)) {
      explicitElements.add(element);
      collectElement(element, selector);
    }
  }

  // Generic language-marked DOM is a fallback only. Prefer the leaf-most target
  // element so wrappers containing keyboard shortcut numbers or other UI labels
  // cannot become separate lexical candidates alongside their clean child text.
  for (const element of document.querySelectorAll("[lang]")) {
    if (explicitElements.has(element)) continue;
    if (hasUsefulTargetLanguageDescendant(element, language)) continue;
    collectElement(element, "leaf-[lang]");
  }

  return collected;
}
