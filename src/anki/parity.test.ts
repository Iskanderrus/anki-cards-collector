import { describe, expect, it, vi } from "vitest";
import type { CollectedItem } from "../core/types";
import { DEFAULT_SETTINGS } from "../settings";
import { deriveLearningStudyContent } from "../learning/policy";
import { mappedSemanticValues } from "./mapping";
import { toTsv } from "./export";
import { AnkiClient } from "./client";
import {
  buildExportPreview,
  exportPreviewStudyContentIsCurrent,
} from "../sidepanel/export-preview";

function parityItem(): CollectedItem {
  return {
    lexicalUnit: {
      id: "parity-unit",
      contentKey: "es::tener ganas de",
      canonicalText: "tener ganas de",
      normalizedCanonicalText: "tener ganas de",
      language: "es",
      note: "feel like",
      status: "ready",
      createdAt: "2026-09-20T10:00:00Z",
      updatedAt: "2026-09-20T10:00:00Z",
    },
    occurrences: [{
      id: "parity-occurrence",
      lexicalUnitId: "parity-unit",
      surfaceText: "tengo ganas de",
      normalizedSurfaceText: "tengo ganas de",
      context: "Hoy tengo ganas de salir a caminar por el centro.",
      capturedAt: "2026-09-20T10:00:00Z",
      source: {
        kind: "web",
        adapter: "generic-web",
        url: "https://example.com/parity",
        title: "Parity",
      },
    }],
  };
}

describe("ACCP-005 review/export parity", () => {
  it("keeps canonical != observed Prompt/Answer/CardKind/context identical across review, preview, TSV and Anki", async () => {
    const item = parityItem();
    const reviewed = deriveLearningStudyContent(item);
    const semantic = mappedSemanticValues(item, reviewed);
    const profile = DEFAULT_SETTINGS.exportProfiles.find(
      (candidate) => candidate.id === DEFAULT_SETTINGS.fallbackProfileId,
    )!;

    const preview = await buildExportPreview(
      [item],
      DEFAULT_SETTINGS,
      {},
      { validateProfileLive: async () => undefined },
    );
    expect(preview.studyItems).toEqual([{
      id: item.lexicalUnit.id,
      canonicalText: semantic.Canonical,
      studyContentSignature: expect.any(String),
      cardKind: semantic.CardKind,
      prompt: semantic.Prompt,
      answer: semantic.Answer,
      observed: semantic.Observed,
      context: semantic.Context,
      note: semantic.Note,
    }]);
    expect(exportPreviewStudyContentIsCurrent(preview, [item])).toBe(true);

    const changed: CollectedItem = {
      ...item,
      lexicalUnit: {
        ...item.lexicalUnit,
        note: "changed after preview",
      },
    };
    expect(exportPreviewStudyContentIsCurrent(preview, [changed])).toBe(false);

    const [header, row] = toTsv([item]).split("\n");
    const tsv = Object.fromEntries(
      header!.split("\t").map((key, index) => [key, row!.split("\t")[index]!]),
    );
    const clean = (value: string) => value.replace(/[\t\r\n]+/g, " ").trim();
    expect(tsv).toMatchObject({
      Prompt: clean(semantic.Prompt),
      Answer: clean(semantic.Answer),
      CardKind: semantic.CardKind,
      Canonical: semantic.Canonical,
      Observed: semantic.Observed,
      Context: clean(semantic.Context),
      Note: clean(semantic.Note),
      Source: semantic.Source,
    });

    let addedFields: Record<string, string> | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        params: {
          note?: { fields?: Record<string, string> };
        };
      };
      if (request.action === "findNotes") {
        return new Response(JSON.stringify({ result: [], error: null }), { status: 200 });
      }
      if (request.action === "addNote") {
        addedFields = request.params.note?.fields;
        return new Response(JSON.stringify({ result: 9001, error: null }), { status: 200 });
      }
      return new Response(JSON.stringify({ result: null, error: null }), { status: 200 });
    }) as unknown as typeof fetch;

    await new AnkiClient("http://127.0.0.1:8765", fetcher).upsert(item, profile);
    expect(addedFields).toMatchObject({
      Prompt: semantic.Prompt,
      Answer: semantic.Answer,
      CardKind: semantic.CardKind,
      Why: semantic.Why,
      Canonical: semantic.Canonical,
      Observed: semantic.Observed,
      Context: semantic.Context,
      Note: semantic.Note,
      Source: semantic.Source,
    });
  });
});
