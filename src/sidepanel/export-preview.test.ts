import { describe, expect, it } from "vitest";
import type {
  CollectedItem,
  CollectorSettings,
  ExportBinding,
  ExportProfile,
} from "../core/types";
import {
  buildExportPreview,
  friendlyExportFailure,
} from "./export-preview";

function item(
  id: string,
  text: string,
  language: string,
  status: "inbox" | "ready" | "archived" = "ready",
): CollectedItem {
  return {
    lexicalUnit: {
      id,
      contentKey: language + ":" + text.toLowerCase(),
      canonicalText: text,
      normalizedCanonicalText: text.toLowerCase(),
      language,
      note: "",
      status,
      createdAt: "2026-09-23T12:00:00.000Z",
      updatedAt: "2026-09-23T12:00:00.000Z",
    },
    occurrences: [{
      id: id + "-occ",
      lexicalUnitId: id,
      surfaceText: text,
      normalizedSurfaceText: text.toLowerCase(),
      context: text + " in context",
      source: {
        kind: "web",
        adapter: "selection",
        url: "https://example.test/",
        title: "Example",
      },
      capturedAt: "2026-09-23T12:00:00.000Z",
    }],
  };
}

function managedProfile(id: string, name: string, deckName: string): ExportProfile {
  return {
    id,
    name,
    deckName,
    modelName: "Collector Basic",
    mode: "collector-managed",
  };
}

const hebrew = managedProfile("he-profile", "Hebrew profile", "Hebrew RU");
const serbian = managedProfile("sr-profile", "Serbian profile", "Serbian RU");

const settings: CollectorSettings = {
  defaultLanguage: "he",
  sourceUrlMode: "sanitized",
  exportProfiles: [hebrew, serbian],
  languageRoutes: [
    { language: "he", profileId: hebrew.id },
    { language: "sr", profileId: serbian.id },
  ],
  fallbackProfileId: hebrew.id,
};

describe("export preview", () => {
  it("groups Ready items by the same resolved routes used by export", () => {
    const preview = buildExportPreview([
      item("1", "שלום", "he"),
      item("2", "תודה", "he"),
      item("3", "dolaziti", "sr"),
      item("4", "not ready", "he", "inbox"),
    ], settings, {});

    expect(preview).toMatchObject({
      totalReady: 3,
      exportable: 3,
      blocked: 0,
    });
    expect(preview.groups).toEqual([
      expect.objectContaining({
        profileName: "Hebrew profile",
        deckName: "Hebrew RU",
        count: 2,
      }),
      expect.objectContaining({
        profileName: "Serbian profile",
        deckName: "Serbian RU",
        count: 1,
      }),
    ]);
  });

  it("honors a pinned per-item profile binding instead of recalculating its destination", () => {
    const binding: ExportBinding = {
      lexicalUnitId: "1",
      profileId: serbian.id,
      state: "override",
      deckName: "Serbian RU",
      modelName: "Collector Basic",
      updatedAt: "2026-09-23T12:00:00.000Z",
    };

    const preview = buildExportPreview(
      [item("1", "שלום", "he")],
      settings,
      { "1": binding },
    );

    expect(preview.groups).toEqual([
      expect.objectContaining({
        profileName: "Serbian profile",
        deckName: "Serbian RU",
        count: 1,
      }),
    ]);
  });

  it("blocks an invalid mapped profile before execution", () => {
    const mapped: ExportProfile = {
      id: "mapped",
      name: "Hebrew existing",
      language: "he",
      deckName: "Hebrew RU",
      modelName: "Hebrew Existing",
      mode: "mapped-user-model",
    };
    const mappedSettings: CollectorSettings = {
      ...settings,
      exportProfiles: [mapped],
      languageRoutes: [{ language: "he", profileId: mapped.id }],
      fallbackProfileId: mapped.id,
    };

    const preview = buildExportPreview([item("1", "שלום", "he")], mappedSettings, {});

    expect(preview.exportable).toBe(0);
    expect(preview.blocked).toBe(1);
    expect(preview.blockedItems[0]?.reason).toMatch(/Anki profile needs attention/i);
  });

  it("translates normal recovery failures into user actions", () => {
    expect(friendlyExportFailure("Failed to fetch AnkiConnect")).toMatch(/Open Anki Desktop/);
    expect(friendlyExportFailure("field mapping changed")).toMatch(/revalidate/i);
    expect(friendlyExportFailure("destination deck is missing")).toMatch(/destination/i);
  });
});
