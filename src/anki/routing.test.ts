import { describe, expect, it } from "vitest";
import type {
  CollectedItem,
  CollectorSettings,
  ExportBinding,
} from "../core/types";
import { resolveExportRoute } from "./routing";

function item(language = "he"): CollectedItem {
  return {
    lexicalUnit: {
      id: "unit-1",
      contentKey: `${language}::שלום`,
      canonicalText: "שלום",
      normalizedCanonicalText: "שלום",
      language,
      note: "",
      status: "ready",
      createdAt: "2026-09-20T00:00:00Z",
      updatedAt: "2026-09-20T00:00:00Z",
    },
    occurrences: [],
  };
}

const settings: CollectorSettings = {
  defaultLanguage: "he",
  sourceUrlMode: "sanitized",
  exportProfiles: [
    {
      id: "he-profile",
      name: "Hebrew",
      deckName: "Hebrew New Default",
      modelName: "Collector Basic",
      mode: "collector-managed",
    },
    {
      id: "fallback",
      name: "Fallback",
      deckName: "Collector Inbox",
      modelName: "Collector Basic",
      mode: "collector-managed",
    },
  ],
  languageRoutes: [{ language: "he", profileId: "he-profile" }],
  fallbackProfileId: "fallback",
};

describe("resolveExportRoute", () => {
  it("uses language routing before fallback for an unbound item", () => {
    const route = resolveExportRoute(item(), settings, null);
    expect(route.source).toBe("language");
    expect(route.profile.id).toBe("he-profile");
    expect(route.profile.deckName).toBe("Hebrew New Default");
  });

  it("lets an unexported item override follow current profile configuration", () => {
    const binding: ExportBinding = {
      lexicalUnitId: "unit-1",
      profileId: "he-profile",
      state: "override",
      updatedAt: "2026-09-20T00:00:00Z",
    };

    const route = resolveExportRoute(item(), settings, binding);
    expect(route.source).toBe("binding");
    expect(route.profile.deckName).toBe("Hebrew New Default");
    expect(route.profile.modelName).toBe("Collector Basic v2");
  });

  it("pins an exported item to its stored destination snapshot after profile edits", () => {
    const binding: ExportBinding = {
      lexicalUnitId: "unit-1",
      profileId: "he-profile",
      state: "exported",
      ankiNoteId: 4242,
      deckName: "Hebrew Original",
      modelName: "Collector Basic",
      updatedAt: "2026-09-20T00:00:00Z",
    };

    const route = resolveExportRoute(item(), settings, binding);
    expect(route.source).toBe("binding");
    expect(route.profile.id).toBe("he-profile");
    expect(route.profile.deckName).toBe("Hebrew Original");
    expect(route.profile.modelName).toBe("Collector Basic");
  });

  it("blocks a binding whose profile was deleted instead of silently falling back", () => {
    const binding: ExportBinding = {
      lexicalUnitId: "unit-1",
      profileId: "missing",
      state: "exported",
      ankiNoteId: 4242,
      deckName: "Hebrew Original",
      modelName: "Collector Basic",
      updatedAt: "2026-09-20T00:00:00Z",
    };

    expect(() => resolveExportRoute(item(), settings, binding)).toThrow("pinned to a missing profile");
  });

  it("pins a reserved destination snapshot even before the Anki note id is saved", () => {
    const binding: ExportBinding = {
      lexicalUnitId: "unit-1",
      profileId: "he-profile",
      state: "reserved",
      deckName: "Hebrew Reserved",
      modelName: "Collector Basic",
      updatedAt: "2026-09-20T00:00:00Z",
    };

    const route = resolveExportRoute(item(), settings, binding);
    expect(route.source).toBe("binding");
    expect(route.profile.deckName).toBe("Hebrew Reserved");
    expect(route.profile.modelName).toBe("Collector Basic");
  });

});
