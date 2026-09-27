import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type { CollectedItem } from "../core/types";
import { DEFAULT_SETTINGS } from "../settings";
import { deriveLearningStudyContent } from "../learning/policy";
import { mappedSemanticValues } from "./mapping";
import { toTsv } from "./export";
import { AnkiClient } from "./client";
import { mappedAnkiFields } from "./mapping";
import { CollectorDatabase } from "../storage/database";
import { CaptureRepository } from "../storage/repository";
import {
  acceptCanonicalFormSuggestion,
  localCanonicalFormProvider,
  requestCanonicalFormAssistance,
} from "../assistance/canonical-form";
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

describe("ACCP-006 accepted-assistance parity", () => {
  it("keeps review, preview, TSV, Collector-managed Anki and mapped Anki on the same accepted canonical", async () => {
    const database = new CollectorDatabase(`collector-assistance-parity-${crypto.randomUUID()}`);
    const repository = new CaptureRepository(database);

    try {
      const captured = await repository.capture({
        text: "tengo",
        context: "Hoy tengo tiempo para terminar el trabajo antes de cenar.",
        language: "ES",
        source: {
          kind: "web",
          adapter: "generic-web",
          url: "https://example.com/assistance-parity",
          title: "Assistance parity",
        },
        capturedAt: "2026-09-27T00:00:00Z",
      });

      const result = await requestCanonicalFormAssistance(localCanonicalFormProvider, {
        lexicalUnitId: captured.lexicalUnit.id,
        lexicalUnitUpdatedAt: captured.lexicalUnit.updatedAt,
        language: captured.lexicalUnit.language,
        observedForm: captured.occurrences[0]!.surfaceText,
        currentCanonical: captured.lexicalUnit.canonicalText,
        context: captured.occurrences[0]!.context,
        occurrenceId: captured.occurrences[0]!.id,
      });
      if (result.kind !== "suggestion") throw new Error("Expected one canonical suggestion.");

      const accepted = await acceptCanonicalFormSuggestion(repository, result, result.suggestion);
      expect(accepted.item.lexicalUnit.status).toBe("inbox");
      expect(accepted.item.lexicalUnit.canonicalText).toBe("tener");
      expect(accepted.item.occurrences[0]!.surfaceText).toBe("tengo");

      await repository.setStatus(accepted.item.lexicalUnit.id, "ready");
      const item = (await repository.list()).find(
        (candidate) => candidate.lexicalUnit.id === accepted.item.lexicalUnit.id,
      )!;
      const reviewed = deriveLearningStudyContent(item);
      expect(reviewed.semanticValues).toMatchObject({
        Canonical: "tener",
        Observed: "tengo",
      });

      const preview = await buildExportPreview(
        [item],
        DEFAULT_SETTINGS,
        {},
        { validateProfileLive: async () => undefined },
      );
      expect(preview.studyItems[0]).toMatchObject({
        canonicalText: "tener",
        observed: "tengo",
      });

      const [header, row] = toTsv([item]).split("\n");
      const tsv = Object.fromEntries(
        header!.split("\t").map((key, index) => [key, row!.split("\t")[index]!]),
      );
      expect(tsv).toMatchObject({
        Canonical: "tener",
        Observed: "tengo",
      });

      const mappedProfile = {
        id: "mapped-assistance",
        name: "Mapped assistance parity",
        deckName: "Spanish RU",
        deckId: "2",
        modelName: "Spanish Existing",
        modelId: "11",
        mode: "mapped-user-model" as const,
        fieldMapping: {
          Prompt: "Front",
          Answer: "Back",
          Canonical: "Lemma",
          Observed: "Surface",
          Context: "Example",
          Note: "Hint",
        },
      };
      expect(mappedAnkiFields(item, mappedProfile, reviewed)).toMatchObject({
        Lemma: "tener",
        Surface: "tengo",
      });

      const added: Array<Record<string, string>> = [];
      const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          action: string;
          params: { note?: { fields?: Record<string, string> } };
        };
        if (request.action === "findNotes") {
          return new Response(JSON.stringify({ result: [], error: null }), { status: 200 });
        }
        if (request.action === "addNote") {
          added.push(request.params.note?.fields ?? {});
          return new Response(
            JSON.stringify({ result: 9100 + added.length, error: null }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ result: null, error: null }), { status: 200 });
      }) as unknown as typeof fetch;
      const client = new AnkiClient("http://127.0.0.1:8765", fetcher);
      const managedProfile = DEFAULT_SETTINGS.exportProfiles.find(
        (candidate) => candidate.id === DEFAULT_SETTINGS.fallbackProfileId,
      )!;

      await client.upsert(item, managedProfile);
      await client.upsert(item, mappedProfile);

      expect(added[0]).toMatchObject({
        Canonical: "tener",
        Observed: "tengo",
      });
      expect(added[1]).toMatchObject({
        Lemma: "tener",
        Surface: "tengo",
      });
    } finally {
      database.close();
      await database.delete();
    }
  });
});

