import { describe, expect, it } from "vitest";
import type { CollectedItem, CollectorSettings, ExportBinding } from "../core/types";
import { parseBackup, serializeBackup } from "./format";

function sampleItem(): CollectedItem {
  return {
    lexicalUnit: {
      id: "unit-1",
      contentKey: "es::tener",
      canonicalText: "tener",
      normalizedCanonicalText: "tener",
      language: "es",
      note: "",
      status: "ready",
      createdAt: "2026-09-18T10:00:00Z",
      updatedAt: "2026-09-18T11:00:00Z",
    },
    occurrences: [{
      id: "occ-1",
      lexicalUnitId: "unit-1",
      surfaceText: "tengo",
      normalizedSurfaceText: "tengo",
      context: "Tengo tiempo.",
      source: {
        kind: "web",
        adapter: "generic-web",
        url: "https://example.com",
        title: "Example",
      },
      capturedAt: "2026-09-18T10:00:00Z",
    }],
  };
}

function settings(): CollectorSettings {
  return {
    defaultLanguage: "es",
    sourceUrlMode: "sanitized",
    exportProfiles: [{
      id: "es-profile",
      name: "Spanish",
      deckName: "Spanish RU",
      modelName: "Collector Basic",
      mode: "collector-managed",
    }],
    languageRoutes: [{ language: "es", profileId: "es-profile" }],
    fallbackProfileId: "es-profile",
  };
}

function binding(): ExportBinding {
  return {
    lexicalUnitId: "unit-1",
    profileId: "es-profile",
    state: "exported",
    ankiNoteId: 4242,
    deckName: "Spanish RU",
    modelName: "Collector Basic",
    updatedAt: "2026-09-19T10:00:00Z",
  };
}

describe("backup format", () => {
  it("round-trips the current backup schema including routing metadata", () => {
    const raw = serializeBackup(
      [sampleItem()],
      settings(),
      [binding()],
      "2026-09-19T10:00:00Z",
    );
    const backup = parseBackup(raw);

    expect(backup.version).toBe(3);
    expect(backup.exportedAt).toBe("2026-09-19T10:00:00Z");
    expect(backup.items).toEqual([sampleItem()]);
    expect(backup.settings).toEqual(settings());
    expect(backup.exportBindings).toEqual([binding()]);
  });

  it("migrates a v1 backup into canonical and observed forms without inventing profile settings", () => {
    const backup = parseBackup(JSON.stringify({
      version: 1,
      exportedAt: "2026-09-19T10:00:00Z",
      items: [{
        lexicalUnit: {
          id: "legacy-unit",
          contentKey: "es::aunque",
          displayText: "aunque",
          normalizedText: "aunque",
          language: "es",
          note: "",
          status: "ready",
          createdAt: "2026-09-18T10:00:00Z",
          updatedAt: "2026-09-18T11:00:00Z",
          ankiNoteId: 777,
        },
        occurrences: [{
          id: "legacy-occ",
          lexicalUnitId: "legacy-unit",
          context: "Aunque llueva, voy.",
          source: {
            kind: "web",
            adapter: "generic-web",
            url: "https://example.com",
            title: "Example",
          },
          capturedAt: "2026-09-18T10:00:00Z",
        }],
      }],
    }));

    expect(backup.version).toBe(3);
    expect(backup.settings).toBeUndefined();
    expect(backup.items[0]?.lexicalUnit.canonicalText).toBe("aunque");
    expect(backup.items[0]?.occurrences[0]?.surfaceText).toBe("aunque");
    expect(backup.exportBindings).toEqual([{
      lexicalUnitId: "legacy-unit",
      profileId: "collector-default",
      state: "exported",
      ankiNoteId: 777,
      updatedAt: "2026-09-18T11:00:00Z",
    }]);
  });

  it("migrates a v2 backup while leaving current profile settings untouched", () => {
    const item = sampleItem();
    item.lexicalUnit.ankiNoteId = 888;

    const backup = parseBackup(JSON.stringify({
      version: 2,
      exportedAt: "2026-09-19T10:00:00Z",
      items: [item],
    }));

    expect(backup.version).toBe(3);
    expect(backup.settings).toBeUndefined();
    expect(backup.exportBindings[0]).toMatchObject({
      lexicalUnitId: "unit-1",
      profileId: "collector-default",
      ankiNoteId: 888,
    });
  });

  it("rejects backups produced by a newer schema", () => {
    expect(() => parseBackup(JSON.stringify({
      version: 4,
      exportedAt: "2026-09-19T10:00:00Z",
      items: [],
    }))).toThrow("Backup version 4 is newer than this extension supports");
  });

  it("rejects export bindings that point to a missing profile", () => {
    const bad = binding();
    bad.profileId = "missing";

    expect(() => serializeBackup([sampleItem()], settings(), [bad])).toThrow(
      "points to a missing export profile",
    );
  });

  it("rejects canonical content keys that do not match form and language", () => {
    const item = sampleItem();
    item.lexicalUnit.contentKey = "es::porque";

    expect(() => parseBackup(serializeBackup([item], settings(), []))).toThrow(
      "contentKey does not match canonical form and language",
    );
  });

  it("rejects observed forms whose normalized value is inconsistent", () => {
    const item = sampleItem();
    item.occurrences[0]!.normalizedSurfaceText = "tener";

    expect(() => parseBackup(serializeBackup([item], settings(), []))).toThrow(
      "normalizedSurfaceText does not match surfaceText",
    );
  });

  it.each([
    ["missing", undefined],
    ["unknown", "mapped-user-modle"],
  ])("rejects a %s export profile mode in a v3 backup", (_label, mode) => {
    const rawSettings = settings() as unknown as Record<string, unknown>;
    const profiles = structuredClone(settings().exportProfiles) as unknown as Array<Record<string, unknown>>;
    if (mode === undefined) {
      delete profiles[0]!.mode;
    } else {
      profiles[0]!.mode = mode;
    }
    rawSettings.exportProfiles = profiles;

    expect(() => parseBackup(JSON.stringify({
      version: 3,
      exportedAt: "2026-09-20T10:00:00Z",
      items: [sampleItem()],
      exportBindings: [],
      settings: rawSettings,
    }))).toThrow("unsupported ownership mode");
  });

  it("conservatively interprets a pre-state v3 binding without a note id as reserved", () => {
    const raw = JSON.parse(serializeBackup(
      [sampleItem()],
      settings(),
      [],
      "2026-09-20T10:00:00Z",
    )) as Record<string, unknown>;
    raw.exportBindings = [{
      lexicalUnitId: "unit-1",
      profileId: "es-profile",
      deckName: "Spanish RU",
      modelName: "Collector Basic",
      updatedAt: "2026-09-20T10:00:00Z",
    }];

    const parsed = parseBackup(JSON.stringify(raw));
    expect(parsed.exportBindings[0]).toMatchObject({
      lexicalUnitId: "unit-1",
      state: "reserved",
      deckName: "Spanish RU",
    });
  });


  it("round-trips mapped user-owned field configuration in backup settings", () => {
    const mappedSettings: CollectorSettings = {
      defaultLanguage: "he",
      sourceUrlMode: "sanitized",
      exportProfiles: [
        {
          id: "he-existing",
          name: "Hebrew existing",
          deckName: "Hebrew RU",
          modelName: "Hebrew Existing",
          mode: "mapped-user-model",
          fieldMapping: {
            Prompt: "Hebrew",
            Answer: "Russian",
            Canonical: "Lemma",
          },
        },
        {
          id: "fallback",
          name: "Fallback",
          deckName: "Collector Inbox",
          modelName: "Collector Basic",
          mode: "collector-managed",
        },
      ],
      languageRoutes: [{ language: "he", profileId: "he-existing" }],
      fallbackProfileId: "fallback",
    };

    const raw = serializeBackup(
      [sampleItem()],
      mappedSettings,
      [],
      "2026-09-21T12:00:00Z",
    );
    const parsed = parseBackup(raw);

    expect(parsed.settings?.exportProfiles.find(
      (profile) => profile.id === "he-existing",
    )).toMatchObject({
      mode: "mapped-user-model",
      fieldMapping: {
        Prompt: "Hebrew",
        Answer: "Russian",
        Canonical: "Lemma",
      },
    });
    expect(parsed.settings?.languageRoutes).toEqual([
      { language: "he", profileId: "he-existing" },
    ]);
  });

});
