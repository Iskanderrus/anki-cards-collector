import { describe, expect, it } from "vitest";
import { LEGACY_DEFAULT_PROFILE_ID } from "./core/types";
import {
  DEFAULT_SETTINGS,
  mergeSettingsForRestore,
  migrateSettings,
} from "./settings";

describe("settings migration", () => {
  it("preserves a legacy user model but routes new cards through Collector Basic in the same deck", () => {
    const settings = migrateSettings({
      defaultLanguage: "HE",
      deckName: "Hebrew RU",
      modelName: "Collector Hebrew",
      sourceUrlMode: "query",
    });

    expect(settings.defaultLanguage).toBe("he");
    expect(settings.sourceUrlMode).toBe("query");
    expect(settings.exportProfiles).toEqual([
      {
        id: LEGACY_DEFAULT_PROFILE_ID,
        name: "Legacy Anki destination",
        deckName: "Hebrew RU",
        modelName: "Collector Hebrew",
        mode: "mapped-user-model",
      },
      {
        id: "collector-deck:Hebrew%20RU",
        name: "Hebrew RU",
        deckName: "Hebrew RU",
        modelName: "Collector Basic",
        mode: "collector-managed",
      },
    ]);
    expect(settings.languageRoutes).toEqual([]);
    expect(settings.fallbackProfileId).toBe("collector-deck:Hebrew%20RU");
  });

  it("normalizes current profiles and drops routes that reference missing profiles", () => {
    const settings = migrateSettings({
      defaultLanguage: " SR ",
      sourceUrlMode: "none",
      exportProfiles: [
        {
          id: "sr-profile",
          name: "Serbian",
          deckName: "Serbian RU",
          modelName: "Collector Basic",
          mode: "collector-managed",
        },
        {
          id: "sr-profile",
          name: "Duplicate",
          deckName: "Wrong",
          modelName: "Wrong",
          mode: "collector-managed",
        },
      ],
      languageRoutes: [
        { language: "SR", profileId: "sr-profile" },
        { language: "he", profileId: "missing" },
      ],
      fallbackProfileId: "missing",
    });

    expect(settings.defaultLanguage).toBe("sr");
    expect(settings.exportProfiles).toHaveLength(1);
    expect(settings.languageRoutes).toEqual([{ language: "sr", profileId: "sr-profile" }]);
    expect(settings.fallbackProfileId).toBe("sr-profile");
  });

  it("falls back to the canonical default settings for malformed profile state", () => {
    const settings = migrateSettings({
      exportProfiles: [{ id: "", name: "", deckName: "", modelName: "" }],
      fallbackProfileId: "missing",
    });

    expect(settings).toEqual(DEFAULT_SETTINGS);
  });
  it("adopts backup profile configuration exactly on a fresh default install", () => {
    const incoming = migrateSettings({
      defaultLanguage: "he",
      sourceUrlMode: "none",
      exportProfiles: [{
        id: "he-profile",
        name: "Hebrew",
        deckName: "Hebrew RU",
        modelName: "Collector Basic",
        mode: "collector-managed",
      }],
      languageRoutes: [{ language: "he", profileId: "he-profile" }],
      fallbackProfileId: "he-profile",
    });

    expect(mergeSettingsForRestore(DEFAULT_SETTINGS, incoming)).toEqual({
      settings: incoming,
      conflicts: [],
    });
  });

  it("merges disjoint backup profiles without changing local fallback or capture settings", () => {
    const current = migrateSettings({
      defaultLanguage: "sr",
      sourceUrlMode: "query",
      exportProfiles: [{
        id: "sr-profile",
        name: "Serbian",
        deckName: "Serbian RU",
        modelName: "Collector Basic",
        mode: "collector-managed",
      }],
      languageRoutes: [{ language: "sr", profileId: "sr-profile" }],
      fallbackProfileId: "sr-profile",
    });
    const incoming = migrateSettings({
      defaultLanguage: "he",
      sourceUrlMode: "none",
      exportProfiles: [{
        id: "he-profile",
        name: "Hebrew",
        deckName: "Hebrew RU",
        modelName: "Collector Basic",
        mode: "collector-managed",
      }],
      languageRoutes: [{ language: "he", profileId: "he-profile" }],
      fallbackProfileId: "he-profile",
    });

    const result = mergeSettingsForRestore(current, incoming);
    expect(result.conflicts).toEqual([]);
    expect(result.settings.defaultLanguage).toBe("sr");
    expect(result.settings.sourceUrlMode).toBe("query");
    expect(result.settings.fallbackProfileId).toBe("sr-profile");
    expect(result.settings.exportProfiles.map((profile) => profile.id)).toEqual([
      "sr-profile",
      "he-profile",
    ]);
    expect(result.settings.languageRoutes).toEqual([
      { language: "he", profileId: "he-profile" },
      { language: "sr", profileId: "sr-profile" },
    ]);
  });

  it("blocks restore when the same profile id or language route has different local meaning", () => {
    const current = migrateSettings({
      exportProfiles: [{
        id: "shared",
        name: "Local",
        deckName: "Local Deck",
        modelName: "Collector Basic",
        mode: "collector-managed",
      }],
      languageRoutes: [{ language: "he", profileId: "shared" }],
      fallbackProfileId: "shared",
    });
    const incoming = migrateSettings({
      exportProfiles: [
        {
          id: "shared",
          name: "Backup",
          deckName: "Backup Deck",
          modelName: "Collector Basic",
          mode: "collector-managed",
        },
        {
          id: "other",
          name: "Other",
          deckName: "Other Deck",
          modelName: "Collector Basic",
          mode: "collector-managed",
        },
      ],
      languageRoutes: [{ language: "he", profileId: "other" }],
      fallbackProfileId: "other",
    });

    const result = mergeSettingsForRestore(current, incoming);
    expect(result.conflicts).toHaveLength(2);
    expect(result.conflicts.join("\n")).toContain("Export destination conflict");
    expect(result.conflicts.join("\n")).toContain("Language route conflict");
  });


  it("keeps the canonical default profile when local corpus state already depends on it", () => {
    const incoming = migrateSettings({
      defaultLanguage: "he",
      exportProfiles: [{
        id: "he-profile",
        name: "Hebrew",
        deckName: "Hebrew RU",
        modelName: "Collector Basic",
        mode: "collector-managed",
      }],
      languageRoutes: [{ language: "he", profileId: "he-profile" }],
      fallbackProfileId: "he-profile",
    });

    const result = mergeSettingsForRestore(DEFAULT_SETTINGS, incoming, true);

    expect(result.conflicts).toEqual([]);
    expect(result.settings.fallbackProfileId).toBe(LEGACY_DEFAULT_PROFILE_ID);
    expect(result.settings.exportProfiles.map((profile) => profile.id)).toEqual([
      LEGACY_DEFAULT_PROFILE_ID,
      "he-profile",
    ]);
    expect(result.settings.languageRoutes).toEqual([
      { language: "he", profileId: "he-profile" },
    ]);
  });


  it("repairs an already-migrated mapped fallback and its language route without changing the legacy profile", () => {
    const settings = migrateSettings({
      defaultLanguage: "he",
      sourceUrlMode: "sanitized",
      exportProfiles: [{
        id: LEGACY_DEFAULT_PROFILE_ID,
        name: "Collector default",
        deckName: "Spanish RU — Uruguay",
        modelName: "Serbian RU — Latin Primary — Standalone v3",
        mode: "mapped-user-model",
      }],
      languageRoutes: [{
        language: "es",
        profileId: LEGACY_DEFAULT_PROFILE_ID,
      }],
      fallbackProfileId: LEGACY_DEFAULT_PROFILE_ID,
    });

    const managed = settings.exportProfiles.find(
      (profile) => profile.mode === "collector-managed",
    );
    const legacy = settings.exportProfiles.find(
      (profile) => profile.id === LEGACY_DEFAULT_PROFILE_ID,
    );

    expect(legacy).toMatchObject({
      deckName: "Spanish RU — Uruguay",
      modelName: "Serbian RU — Latin Primary — Standalone v3",
      mode: "mapped-user-model",
    });
    expect(managed).toMatchObject({
      deckName: "Spanish RU — Uruguay",
      modelName: "Collector Basic",
      mode: "collector-managed",
    });
    expect(settings.fallbackProfileId).toBe(managed?.id);
    expect(settings.languageRoutes).toEqual([
      { language: "es", profileId: managed?.id },
    ]);
  });


  it.each([
    ["missing", undefined],
    ["unknown", "collector-managd"],
  ])("rejects a %s ownership mode on a structurally complete profile", (_label, mode) => {
    const profile: Record<string, unknown> = {
      id: "unsafe",
      name: "Unsafe",
      deckName: "Hebrew RU",
      modelName: "My Existing Hebrew Model",
    };
    if (mode !== undefined) profile.mode = mode;

    expect(() => migrateSettings({
      exportProfiles: [profile],
      fallbackProfileId: "unsafe",
    })).toThrow("unsupported ownership mode");
  });

});
