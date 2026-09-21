import { describe, expect, it } from "vitest";
import type { ExportBinding, ExportProfile } from "../core/types";
import type { AnkiCatalogSnapshot, AnkiModelDetail } from "./catalog";
import {
  assessUsedMappedProfileEdit,
  buildMappedPayloadPreview,
  profileLanguageFromSavedState,
  validateMappedProfileAgainstLive,
} from "./profile-setup";

const profile: ExportProfile = {
  id: "he-existing",
  name: "Hebrew existing",
  language: "he",
  deckName: "Hebrew RU",
  deckId: "2",
  modelName: "Hebrew Existing",
  modelId: "11",
  mode: "mapped-user-model",
  fieldMapping: { Prompt: "Hebrew", Answer: "Russian" },
  identityStrategy: "collector-tag",
};

const snapshot: AnkiCatalogSnapshot = {
  ankiConnectVersion: 6,
  decks: [{ id: 2, name: "Hebrew RU" }],
  models: [{ id: 11, name: "Hebrew Existing" }],
  refreshedAt: "2026-09-21T18:00:00Z",
};

const detail: AnkiModelDetail = {
  id: 11,
  name: "Hebrew Existing",
  fields: ["Hebrew", "Russian", "Example"],
  templates: [],
  css: "",
  refreshedAt: "2026-09-21T18:00:00Z",
};

describe("guided profile setup domain", () => {
  it("keeps profile language first-class while allowing a legacy single-route fallback", () => {
    expect(profileLanguageFromSavedState(profile, [])).toBe("he");
    expect(profileLanguageFromSavedState(
      { ...profile, language: undefined },
      [{ language: "sr", profileId: profile.id }],
    )).toBe("sr");
    expect(profileLanguageFromSavedState(
      { ...profile, language: undefined },
      [
        { language: "sr", profileId: profile.id },
        { language: "hr", profileId: profile.id },
      ],
    )).toBeUndefined();
  });

  it("shows mapped values and explicitly marks unmapped user fields untouched", () => {
    expect(buildMappedPayloadPreview(profile.fieldMapping, detail.fields)).toEqual([
      { field: "Hebrew", semantic: "Prompt", value: "Example prompt", untouched: false },
      { field: "Russian", semantic: "Answer", value: "Example answer", untouched: false },
      { field: "Example", untouched: true },
    ]);
  });

  it("accepts exact live IDs and rejects a same-name replacement object", () => {
    expect(validateMappedProfileAgainstLive(profile, snapshot, detail)).toEqual({ valid: true, errors: [] });
    const validation = validateMappedProfileAgainstLive(
      profile,
      { ...snapshot, models: [{ id: 99, name: "Hebrew Existing" }] },
      { ...detail, id: 99 },
    );
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("same-name replacement");
  });

  it("fails closed when mapped fields disappear from the live note type", () => {
    const validation = validateMappedProfileAgainstLive(profile, snapshot, {
      ...detail,
      fields: ["Hebrew", "Example"],
    });
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain('Mapped Anki field "Russian"');
  });

  it("distinguishes blocked identity changes from consequence-bearing remaps on used profiles", () => {
    const bindings: ExportBinding[] = [{
      lexicalUnitId: "unit-1",
      profileId: profile.id,
      state: "exported",
      ankiNoteId: 42,
      deckName: profile.deckName,
      deckId: profile.deckId,
      modelName: profile.modelName,
      modelId: profile.modelId,
      updatedAt: "2026-09-21T18:00:00Z",
    }];

    expect(assessUsedMappedProfileEdit(profile, { ...profile, deckId: "999" }, bindings)).toMatchObject({
      durableBindingCount: 1,
      identityChanged: true,
      fieldMappingChanged: false,
    });
    expect(assessUsedMappedProfileEdit(
      profile,
      { ...profile, fieldMapping: { Prompt: "Russian", Answer: "Hebrew" } },
      bindings,
    )).toMatchObject({
      durableBindingCount: 1,
      identityChanged: false,
      fieldMappingChanged: true,
    });
  });
});
