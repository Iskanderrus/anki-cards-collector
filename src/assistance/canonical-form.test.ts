import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CaptureDraft } from "../core/types";
import { CollectorDatabase } from "../storage/database";
import { CaptureRepository } from "../storage/repository";
import {
  CanonicalFormRequestGate,
  acceptCanonicalFormSuggestion,
  localCanonicalFormProvider,
  requestCanonicalFormAssistance,
  type CanonicalFormProvider,
} from "./canonical-form";

function draft(text: string, context = text, language = "es"): CaptureDraft {
  return {
    text,
    context,
    language,
    source: {
      kind: "web",
      adapter: "generic-web",
      url: "https://example.com/assistance",
      title: "Assistance fixture",
    },
    capturedAt: new Date().toISOString(),
  };
}

function providerReturning(value: unknown): CanonicalFormProvider {
  return {
    supports: () => true,
    suggest: async () => value as never,
  };
}

describe("ACCP-006 canonical-form assistance provider boundary", () => {
  it("returns one normalized deterministic suggestion", async () => {
    const result = await requestCanonicalFormAssistance(localCanonicalFormProvider, {
      lexicalUnitId: "unit-a",
      lexicalUnitUpdatedAt: "2026-09-27T00:00:00.000Z",
      language: "ES",
      observedForm: "Tengo",
      currentCanonical: "tengo",
      context: "Tengo tiempo.",
    });

    expect(result).toMatchObject({
      kind: "suggestion",
      snapshot: {
        lexicalUnitId: "unit-a",
        language: "es",
        observedForm: "Tengo",
        currentCanonical: "tengo",
      },
      suggestion: {
        proposedCanonical: "tener",
        language: "es",
        confidence: "high",
        category: "explicit-irregular-inflection",
      },
    });
  });

  it("returns no suggestion for a form outside the conservative local lexicon", async () => {
    const result = await requestCanonicalFormAssistance(localCanonicalFormProvider, {
      lexicalUnitId: "unit-a",
      lexicalUnitUpdatedAt: "2026-09-27T00:00:00.000Z",
      language: "es",
      observedForm: "casa",
      currentCanonical: "casa",
    });
    expect(result.kind).toBe("none");
  });

  it("keeps genuine ambiguity as multiple suggestions", async () => {
    const result = await requestCanonicalFormAssistance(localCanonicalFormProvider, {
      lexicalUnitId: "unit-a",
      lexicalUnitUpdatedAt: "2026-09-27T00:00:00.000Z",
      language: "es",
      observedForm: "fui",
      currentCanonical: "fui",
      context: "Ayer fui allí.",
    });

    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") throw new Error("Expected ambiguous assistance.");
    expect(result.suggestions.map((candidate) => candidate.proposedCanonical)).toEqual(["ir", "ser"]);
    expect(result.suggestions.every((candidate) => candidate.confidence === "ambiguous")).toBe(true);
  });

  it("treats unsupported language as normal absence", async () => {
    const result = await requestCanonicalFormAssistance(localCanonicalFormProvider, {
      lexicalUnitId: "unit-a",
      lexicalUnitUpdatedAt: "2026-09-27T00:00:00.000Z",
      language: "SR",
      observedForm: "imam",
      currentCanonical: "imam",
    });
    expect(result).toMatchObject({ kind: "unsupported", language: "sr" });
  });

  it("turns provider capability-check exceptions into non-blocking unavailability", async () => {
    const provider: CanonicalFormProvider = {
      supports: () => {
        throw new Error("capability check exploded");
      },
      suggest: async () => ({ kind: "none" }),
    };
    const result = await requestCanonicalFormAssistance(provider, {
      lexicalUnitId: "unit-a",
      lexicalUnitUpdatedAt: "2026-09-27T00:00:00.000Z",
      language: "es",
      observedForm: "tengo",
      currentCanonical: "tengo",
    });
    expect(result).toMatchObject({ kind: "unavailable", reason: "provider-error" });
  });

  it("turns provider exceptions into non-blocking unavailability", async () => {
    const provider: CanonicalFormProvider = {
      supports: () => true,
      suggest: async () => {
        throw new Error("provider exploded");
      },
    };
    const result = await requestCanonicalFormAssistance(provider, {
      lexicalUnitId: "unit-a",
      lexicalUnitUpdatedAt: "2026-09-27T00:00:00.000Z",
      language: "es",
      observedForm: "tengo",
      currentCanonical: "tengo",
    });
    expect(result).toMatchObject({ kind: "unavailable", reason: "provider-error" });
  });

  it("fails malformed provider output closed", async () => {
    const result = await requestCanonicalFormAssistance(
      providerReturning({ kind: "suggestions", suggestions: [{ proposedCanonical: "" }] }),
      {
        lexicalUnitId: "unit-a",
        lexicalUnitUpdatedAt: "2026-09-27T00:00:00.000Z",
        language: "es",
        observedForm: "tengo",
        currentCanonical: "tengo",
      },
    );
    expect(result).toMatchObject({ kind: "unavailable", reason: "malformed-result" });
  });

  it("does not offer the already-current canonical form", async () => {
    const result = await requestCanonicalFormAssistance(localCanonicalFormProvider, {
      lexicalUnitId: "unit-a",
      lexicalUnitUpdatedAt: "2026-09-27T00:00:00.000Z",
      language: "es",
      observedForm: "tengo",
      currentCanonical: "tener",
    });
    expect(result.kind).toBe("none");
  });

  it("bounds provider context without changing corpus input", async () => {
    let receivedContext = "";
    const provider: CanonicalFormProvider = {
      supports: () => true,
      suggest: async (input) => {
        receivedContext = input.context ?? "";
        return { kind: "none" };
      },
    };
    const context = "x".repeat(2000);
    await requestCanonicalFormAssistance(provider, {
      lexicalUnitId: "unit-a",
      lexicalUnitUpdatedAt: "2026-09-27T00:00:00.000Z",
      language: "es",
      observedForm: "tengo",
      currentCanonical: "tengo",
      context,
    });
    expect(receivedContext.length).toBeLessThanOrEqual(320);
    expect(context).toHaveLength(2000);
  });
});

describe("ACCP-006 request supersession", () => {
  it("supersedes an older request for the same lexical identity", () => {
    const gate = new CanonicalFormRequestGate();
    const first = gate.start("A");
    const second = gate.start("A");
    expect(gate.isCurrent(first, "A")).toBe(false);
    expect(gate.isCurrent(second, "A")).toBe(true);
  });

  it("rejects a late result after switching lexical identity", () => {
    const gate = new CanonicalFormRequestGate();
    const first = gate.start("A");
    gate.invalidate();
    gate.start("B");
    expect(gate.isCurrent(first, "B")).toBe(false);
  });
});

describe("ACCP-006 corpus safety", () => {
  let database: CollectorDatabase;
  let repository: CaptureRepository;

  beforeEach(() => {
    database = new CollectorDatabase(`collector-assistance-${crypto.randomUUID()}`);
    repository = new CaptureRepository(database);
  });

  afterEach(async () => {
    database.close();
    await database.delete();
  });

  it("does not mutate corpus before acceptance or when dismissed", async () => {
    const captured = await repository.capture(draft("tengo", "Tengo tiempo."));
    const before = JSON.stringify(await repository.list());

    const result = await requestCanonicalFormAssistance(localCanonicalFormProvider, {
      lexicalUnitId: captured.lexicalUnit.id,
      lexicalUnitUpdatedAt: captured.lexicalUnit.updatedAt,
      language: captured.lexicalUnit.language,
      observedForm: captured.occurrences[0]!.surfaceText,
      currentCanonical: captured.lexicalUnit.canonicalText,
      context: captured.occurrences[0]!.context,
      occurrenceId: captured.occurrences[0]!.id,
    });

    expect(result.kind).toBe("suggestion");
    expect(JSON.stringify(await repository.list())).toBe(before);
  });

  it("preserves Ready state when a suggestion is dismissed without acceptance", async () => {
    const captured = await repository.capture(draft("tengo", "Tengo tiempo para estudiar esta tarde."));
    await repository.setStatus(captured.lexicalUnit.id, "ready");
    const current = (await repository.list()).find(
      (item) => item.lexicalUnit.id === captured.lexicalUnit.id,
    )!;
    const before = JSON.stringify(current);

    const result = await requestCanonicalFormAssistance(localCanonicalFormProvider, {
      lexicalUnitId: current.lexicalUnit.id,
      lexicalUnitUpdatedAt: current.lexicalUnit.updatedAt,
      language: current.lexicalUnit.language,
      observedForm: current.occurrences[0]!.surfaceText,
      currentCanonical: current.lexicalUnit.canonicalText,
      context: current.occurrences[0]!.context,
    });

    expect(result.kind).toBe("suggestion");
    const after = (await repository.list()).find(
      (item) => item.lexicalUnit.id === captured.lexicalUnit.id,
    )!;
    expect(after.lexicalUnit.status).toBe("ready");
    expect(JSON.stringify(after)).toBe(before);
  });

  it("rejects a candidate that was not offered by the provider result", async () => {
    const captured = await repository.capture(draft("tengo", "Tengo tiempo."));
    const result = await requestCanonicalFormAssistance(localCanonicalFormProvider, {
      lexicalUnitId: captured.lexicalUnit.id,
      lexicalUnitUpdatedAt: captured.lexicalUnit.updatedAt,
      language: captured.lexicalUnit.language,
      observedForm: captured.occurrences[0]!.surfaceText,
      currentCanonical: captured.lexicalUnit.canonicalText,
    });
    if (result.kind !== "suggestion") throw new Error("Expected one suggestion.");

    await expect(
      acceptCanonicalFormSuggestion(repository, result, {
        ...result.suggestion,
        proposedCanonical: "ser",
      }),
    ).rejects.toThrow(/no longer valid/i);

    expect((await repository.list())[0]?.lexicalUnit.canonicalText).toBe("tengo");
  });

  it("accepts through the canonical edit path while preserving lexical identity, observed evidence and export binding", async () => {
    const captured = await repository.capture(draft("tengo", "Tengo tiempo."));
    await repository.setExportBinding({
      lexicalUnitId: captured.lexicalUnit.id,
      profileId: "profile-a",
      state: "exported",
      ankiNoteId: 6060,
      deckName: "Spanish RU",
      modelName: "Collector Basic",
    });
    await repository.setStatus(captured.lexicalUnit.id, "ready");
    const current = (await repository.list()).find((item) => item.lexicalUnit.id === captured.lexicalUnit.id)!;

    const result = await requestCanonicalFormAssistance(localCanonicalFormProvider, {
      lexicalUnitId: current.lexicalUnit.id,
      lexicalUnitUpdatedAt: current.lexicalUnit.updatedAt,
      language: current.lexicalUnit.language,
      observedForm: current.occurrences[0]!.surfaceText,
      currentCanonical: current.lexicalUnit.canonicalText,
      context: current.occurrences[0]!.context,
      occurrenceId: current.occurrences[0]!.id,
    });
    if (result.kind !== "suggestion") throw new Error("Expected one suggestion.");

    const accepted = await acceptCanonicalFormSuggestion(repository, result, result.suggestion);

    expect(accepted.item.lexicalUnit.id).toBe(captured.lexicalUnit.id);
    expect(accepted.item.lexicalUnit.canonicalText).toBe("tener");
    expect(accepted.item.lexicalUnit.status).toBe("inbox");
    expect(accepted.item.occurrences[0]?.surfaceText).toBe("tengo");
    expect(accepted.item.occurrences[0]?.context).toBe("Tengo tiempo.");
    expect(await repository.getExportBinding(captured.lexicalUnit.id)).toMatchObject({
      state: "exported",
      ankiNoteId: 6060,
      profileId: "profile-a",
    });
  });

  it("allows same-canonical distinct units and never performs an implicit merge", async () => {
    const canonical = await repository.capture(draft("tener", "Quiero tener tiempo."));
    const observed = await repository.capture(draft("tengo", "Tengo tiempo."));

    const result = await requestCanonicalFormAssistance(localCanonicalFormProvider, {
      lexicalUnitId: observed.lexicalUnit.id,
      lexicalUnitUpdatedAt: observed.lexicalUnit.updatedAt,
      language: observed.lexicalUnit.language,
      observedForm: observed.occurrences[0]!.surfaceText,
      currentCanonical: observed.lexicalUnit.canonicalText,
    });
    if (result.kind !== "suggestion") throw new Error("Expected one suggestion.");

    const accepted = await acceptCanonicalFormSuggestion(repository, result, result.suggestion);
    const items = await repository.list();

    expect(accepted.preview.sameCanonicalCandidates.map((candidate) => candidate.id)).toContain(
      canonical.lexicalUnit.id,
    );
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.lexicalUnit.id).sort()).toEqual(
      [canonical.lexicalUnit.id, observed.lexicalUnit.id].sort(),
    );
    expect(items.every((item) => item.lexicalUnit.canonicalText === "tener")).toBe(true);
  });

  it("keeps a split sibling isolated", async () => {
    const source = await repository.capture(draft("tengo", "Hoy tengo tiempo."));
    const withSecond = await repository.capture(draft("tengo", "Ahora tengo hambre."));
    const movedId = withSecond.occurrences[1]!.id;
    const preview = await repository.previewSplit(source.lexicalUnit.id, [movedId]);
    const split = await repository.splitLexicalUnit({
      sourceId: source.lexicalUnit.id,
      selectedOccurrenceIds: [movedId],
      expectedSnapshotToken: preview.snapshotToken,
      canonicalText: "tengo",
      note: "",
    });

    const result = await requestCanonicalFormAssistance(localCanonicalFormProvider, {
      lexicalUnitId: split.created.lexicalUnit.id,
      lexicalUnitUpdatedAt: split.created.lexicalUnit.updatedAt,
      language: split.created.lexicalUnit.language,
      observedForm: split.created.occurrences[0]!.surfaceText,
      currentCanonical: split.created.lexicalUnit.canonicalText,
    });
    if (result.kind !== "suggestion") throw new Error("Expected one suggestion.");
    await acceptCanonicalFormSuggestion(repository, result, result.suggestion);

    const items = await repository.list();
    expect(items.find((item) => item.lexicalUnit.id === split.source.lexicalUnit.id)?.lexicalUnit.canonicalText)
      .toBe("tengo");
    expect(items.find((item) => item.lexicalUnit.id === split.created.lexicalUnit.id)?.lexicalUnit.canonicalText)
      .toBe("tener");
  });

  it("fails a stale suggestion closed after a newer manual canonical edit", async () => {
    const captured = await repository.capture(draft("tengo", "Tengo tiempo."));
    const result = await requestCanonicalFormAssistance(localCanonicalFormProvider, {
      lexicalUnitId: captured.lexicalUnit.id,
      lexicalUnitUpdatedAt: captured.lexicalUnit.updatedAt,
      language: captured.lexicalUnit.language,
      observedForm: captured.occurrences[0]!.surfaceText,
      currentCanonical: captured.lexicalUnit.canonicalText,
    });
    if (result.kind !== "suggestion") throw new Error("Expected one suggestion.");

    await repository.update(captured.lexicalUnit.id, {
      canonicalText: "poseer",
      language: "es",
      note: "",
    });

    await expect(
      acceptCanonicalFormSuggestion(repository, result, result.suggestion),
    ).rejects.toThrow(/stale|changed/i);
    expect((await repository.list())[0]?.lexicalUnit.canonicalText).toBe("poseer");
  });

  it("fails a stale suggestion closed when its lexical identity was explicitly merged away", async () => {
    const source = await repository.capture(draft("tengo", "Tengo tiempo."));
    const target = await repository.capture(draft("tener", "Quiero tener tiempo."));
    await repository.setExportBinding({
      lexicalUnitId: target.lexicalUnit.id,
      profileId: "profile-a",
      state: "exported",
      ankiNoteId: 7070,
      deckName: "Spanish RU",
      modelName: "Collector Basic",
    });

    const result = await requestCanonicalFormAssistance(localCanonicalFormProvider, {
      lexicalUnitId: source.lexicalUnit.id,
      lexicalUnitUpdatedAt: source.lexicalUnit.updatedAt,
      language: source.lexicalUnit.language,
      observedForm: source.occurrences[0]!.surfaceText,
      currentCanonical: source.lexicalUnit.canonicalText,
    });
    if (result.kind !== "suggestion") throw new Error("Expected one suggestion.");

    const mergePreview = await repository.previewMerge(source.lexicalUnit.id, target.lexicalUnit.id);
    const merged = await repository.mergeLexicalUnits({
      sourceId: source.lexicalUnit.id,
      targetId: target.lexicalUnit.id,
      expectedSnapshotToken: mergePreview.snapshotToken,
      canonicalText: "tener",
      note: "",
    });
    expect(merged.removedLexicalUnitId).toBe(source.lexicalUnit.id);

    await expect(
      acceptCanonicalFormSuggestion(repository, result, result.suggestion),
    ).rejects.toThrow(/stale|no longer exists|changed/i);
    expect((await repository.list())).toHaveLength(1);
  });

  it("manual canonical editing remains usable after provider failure", async () => {
    const captured = await repository.capture(draft("tengo", "Tengo tiempo."));
    const provider: CanonicalFormProvider = {
      supports: () => true,
      suggest: async () => {
        throw new Error("offline");
      },
    };
    const result = await requestCanonicalFormAssistance(provider, {
      lexicalUnitId: captured.lexicalUnit.id,
      lexicalUnitUpdatedAt: captured.lexicalUnit.updatedAt,
      language: captured.lexicalUnit.language,
      observedForm: captured.occurrences[0]!.surfaceText,
      currentCanonical: captured.lexicalUnit.canonicalText,
    });
    expect(result.kind).toBe("unavailable");

    const updated = await repository.update(captured.lexicalUnit.id, {
      canonicalText: "tener",
      language: "es",
      note: "",
    });
    expect(updated.lexicalUnit.canonicalText).toBe("tener");
  });
});
