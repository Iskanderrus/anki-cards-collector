import type { CaptureDraft, CaptureSource } from "../core/types";

export interface SourceAdapter {
  readonly id: string;
  supports(location: Location): boolean;
  capture(selection: Selection, location: Location, title: string): CaptureDraft | null;
}

function selectedText(selection: Selection): string {
  return selection.toString().replace(/\s+/g, " ").trim();
}

function nearestContext(selection: Selection, selectors: string): string {
  if (!selection.rangeCount) return "";

  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const element = node instanceof Element ? node : node.parentElement;
  const container = element?.closest(selectors) ?? element;
  return (container?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 800);
}

function source(kind: CaptureSource["kind"], adapter: string, location: Location, title: string): CaptureSource {
  return { kind, adapter, url: location.href, title };
}

export class GenericWebAdapter implements SourceAdapter {
  readonly id = "generic-web";

  supports(): boolean {
    return true;
  }

  capture(selection: Selection, location: Location, title: string): CaptureDraft | null {
    const text = selectedText(selection);
    if (!text) return null;

    return {
      text,
      context: nearestContext(selection, "p, li, blockquote, article, section, main, div"),
      language: "und",
      source: source("web", this.id, location, title),
      capturedAt: new Date().toISOString(),
    };
  }
}

export class DuolingoAdapter implements SourceAdapter {
  readonly id = "duolingo-visible-dom";

  supports(location: Location): boolean {
    return location.hostname === "duolingo.com" || location.hostname.endsWith(".duolingo.com");
  }

  capture(selection: Selection, location: Location, title: string): CaptureDraft | null {
    const text = selectedText(selection);
    if (!text) return null;

    return {
      text,
      context: nearestContext(
        selection,
        "[data-test*='challenge'], [data-test*='sentence'], main, section, article, div",
      ),
      language: "und",
      source: source("duolingo", this.id, location, title),
      capturedAt: new Date().toISOString(),
    };
  }
}

export function adapterFor(location: Location): SourceAdapter {
  const adapters: SourceAdapter[] = [new DuolingoAdapter(), new GenericWebAdapter()];
  return adapters.find((adapter) => adapter.supports(location)) ?? new GenericWebAdapter();
}
