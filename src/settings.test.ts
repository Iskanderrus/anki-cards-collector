import { describe, expect, it } from "vitest";
import { LEGACY_DEFAULT_PROFILE_ID } from "./core/types";
import { DEFAULT_SETTINGS, migrateSettings } from "./settings";

describe("settings migration", () => {
  it("converts legacy global deck/model settings into one deterministic default profile", () => {
    const settings = migrateSettings({
      defaultLanguage: "HE",
      deckName: "Hebrew RU",
      modelName: "Collector Hebrew",
      sourceUrlMode: "query",
    });

    expect(settings).toEqual({
      defaultLanguage: "he",
      sourceUrlMode: "query",
      exportProfiles: [{
        id: LEGACY_DEFAULT_PROFILE_ID,
        name: "Collector default",
        deckName: "Hebrew RU",
        modelName: "Collector Hebrew",
        mode: "collector-managed",
      }],
      languageRoutes: [],
      fallbackProfileId: LEGACY_DEFAULT_PROFILE_ID,
    });
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
});
