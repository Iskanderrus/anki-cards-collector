import { describe, expect, it } from "vitest";
import type { CollectedItem, ExportProfile } from "../core/types";
import {
  collectorIdentityQuery,
  collectorIdentityTag,
  mappedAnkiFields,
  mappedProfileIsConfigured,
  normalizeFieldMapping,
  validateFieldMapping,
  validateMappedProfile,
  validateMappedQuestionFields,
} from "./mapping";

function item(): CollectedItem {
  return {
    lexicalUnit: {
      id: "unit-1",
      contentKey: "es::tener ganas de",
      canonicalText: "tener ganas de",
      normalizedCanonicalText: "tener ganas de",
      language: "es",
      note: "feel like",
      status: "ready",
      createdAt: "2026-09-18T10:00:00Z",
      updatedAt: "2026-09-19T10:00:00Z",
    },
    occurrences: [{
      id: "occ-1",
      lexicalUnitId: "unit-1",
      surfaceText: "tengo ganas de",
      normalizedSurfaceText: "tengo ganas de",
      context: "Hoy tengo ganas de salir a caminar por el centro.",
      capturedAt: "2026-09-18T10:00:00Z",
      source: {
        kind: "web",
        adapter: "generic-web",
        url: "https://example.com",
        title: "Example",
      },
    }],
  };
}

function profile(): ExportProfile {
  return {
    id: "mapped",
    name: "Spanish existing",
    deckName: "Spanish RU",
    deckId: "2",
    modelName: "Spanish Existing",
    modelId: "11",
    mode: "mapped-user-model",
    fieldMapping: {
      Prompt: "Front",
      Answer: "Back",
      Canonical: "Lemma",
      Context: "Example",
    },
  };
}

describe("mapped user-model field mapping", () => {
  it("normalizes only supported non-empty semantic mappings", () => {
    expect(normalizeFieldMapping({
      Prompt: " Front ",
      Answer: "Back",
      Canonical: "",
      Unknown: "Ignored",
    })).toEqual({
      Prompt: "Front",
      Answer: "Back",
    });
  });

  it("requires Prompt and Answer and rejects duplicate destination fields", () => {
    expect(validateFieldMapping({ Prompt: "Front" }).errors.join("\n")).toContain("Answer");

    const duplicate = validateFieldMapping({
      Prompt: "Text",
      Answer: "Text",
    });
    expect(duplicate.valid).toBe(false);
    expect(duplicate.errors.join("\n")).toContain("both Prompt and Answer");
  });

  it("validates mapped targets against the live Anki field list", () => {
    const result = validateFieldMapping(profile().fieldMapping, [
      "Front",
      "Back",
      "Lemma",
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain('"Example"');
  });

  it("recognizes only complete mapped profiles as configured", () => {
    expect(mappedProfileIsConfigured(profile())).toBe(true);
    expect(mappedProfileIsConfigured({
      ...profile(),
      deckId: undefined,
    })).toBe(false);
    expect(mappedProfileIsConfigured({
      ...profile(),
      modelId: undefined,
    })).toBe(false);
    expect(mappedProfileIsConfigured({
      ...profile(),
      fieldMapping: { Prompt: "Front" },
    })).toBe(false);
  });

  it("projects only explicitly mapped semantic values into user-owned fields", () => {
    expect(mappedAnkiFields(item(), profile())).toEqual({
      Front: "Hoy […] salir a caminar por el centro.",
      Back: "tengo ganas de\n\nCanonical: tener ganas de\n\nfeel like",
      Lemma: "tener ganas de",
      Example: "Hoy tengo ganas de salir a caminar por el centro.",
    });
  });

  it("uses a stable hex-only exact tag query for arbitrary Collector ids", () => {
    expect(collectorIdentityTag("unit-1")).toBe("collector::id::756e69742d31");

    for (const id of ["unit_1", "unit*1", "unit(1)", "parent::child"]) {
      const tag = collectorIdentityTag(id);
      expect(tag).toMatch(/^collector::id::[0-9a-f]+$/);
      expect(tag).not.toMatch(/[\*_()]/);
      expect(collectorIdentityQuery(id)).toBe("tag:re:^" + tag + "$");

      const exactPattern = new RegExp("^" + tag + "$");
      expect(exactPattern.test(tag)).toBe(true);
      expect(exactPattern.test(tag + "::child")).toBe(false);
    }

    expect(() => collectorIdentityTag("")).toThrow("cannot be empty");
  });

  it("requires the mapped Prompt field to appear on a question side", () => {
    expect(() => validateMappedQuestionFields(profile(), {
      Recognition: [["Front"], ["Front", "Back"]],
    })).not.toThrow();

    expect(() => validateMappedQuestionFields(profile(), {
      Recognition: [["Metadata"], ["Back"]],
    })).toThrow('Mapped Prompt field "Front" is not used on the question side');
  });

  it("returns normalized mapping when a mapped profile is valid", () => {
    expect(validateMappedProfile(profile(), ["Front", "Back", "Lemma", "Example"])).toEqual({
      Prompt: "Front",
      Answer: "Back",
      Canonical: "Lemma",
      Context: "Example",
    });
  });
});
