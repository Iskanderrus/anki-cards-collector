import { describe, expect, it, vi } from "vitest";
import type { ExportBinding, ExportProfile } from "../core/types";
import { moveExportedNote, type ExportMoveClient } from "./move";

const currentProfile: ExportProfile = {
  id: "old-profile",
  name: "Old",
  deckName: "Hebrew Old",
  modelName: "Collector Basic",
  mode: "collector-managed",
};

const targetProfile: ExportProfile = {
  id: "new-profile",
  name: "New",
  deckName: "Hebrew New",
  modelName: "Collector Basic",
  mode: "collector-managed",
};

const binding: ExportBinding = {
  lexicalUnitId: "unit-1",
  profileId: "old-profile",
  ankiNoteId: 4242,
  deckName: "Hebrew Old",
  modelName: "Collector Basic",
  updatedAt: "2026-09-20T00:00:00Z",
};

function client(): ExportMoveClient {
  return {
    ensureDeckAndModel: vi.fn(async () => undefined),
    moveNoteToDeck: vi.fn(async () => undefined),
  };
}

describe("moveExportedNote", () => {
  it("moves first, then persists the new pinned binding", async () => {
    const exportClient = client();
    const persist = vi.fn(async () => undefined);

    const result = await moveExportedNote(
      {
        lexicalUnitId: "unit-1",
        binding,
        currentProfile,
        targetProfile,
      },
      exportClient,
      persist,
    );

    expect(exportClient.ensureDeckAndModel).toHaveBeenCalledWith(targetProfile);
    expect(exportClient.moveNoteToDeck).toHaveBeenCalledWith(4242, "Hebrew New");
    expect(persist).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      lexicalUnitId: "unit-1",
      profileId: "new-profile",
      ankiNoteId: 4242,
      deckName: "Hebrew New",
      modelName: "Collector Basic",
    });
  });

  it("rolls Anki back to the original deck when local binding persistence fails", async () => {
    const exportClient = client();

    await expect(moveExportedNote(
      {
        lexicalUnitId: "unit-1",
        binding,
        currentProfile,
        targetProfile,
      },
      exportClient,
      async () => {
        throw new Error("IndexedDB unavailable");
      },
    )).rejects.toThrow('moved back to "Hebrew Old"');

    expect(exportClient.moveNoteToDeck).toHaveBeenNthCalledWith(1, 4242, "Hebrew New");
    expect(exportClient.moveNoteToDeck).toHaveBeenNthCalledWith(2, 4242, "Hebrew Old");
  });

  it("reports a hard divergence if both binding persistence and Anki rollback fail", async () => {
    const moveNoteToDeck = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Anki rollback failed"));
    const exportClient: ExportMoveClient = {
      ensureDeckAndModel: vi.fn(async () => undefined),
      moveNoteToDeck,
    };

    await expect(moveExportedNote(
      {
        lexicalUnitId: "unit-1",
        binding,
        currentProfile,
        targetProfile,
      },
      exportClient,
      async () => {
        throw new Error("IndexedDB unavailable");
      },
    )).rejects.toThrow("Local and Anki destination state may differ");
  });

  it("blocks a note-type change before any Anki mutation", async () => {
    const exportClient = client();

    await expect(moveExportedNote(
      {
        lexicalUnitId: "unit-1",
        binding,
        currentProfile,
        targetProfile: { ...targetProfile, modelName: "Other Model" },
      },
      exportClient,
      async () => undefined,
    )).rejects.toThrow("requires ACCP-014");

    expect(exportClient.ensureDeckAndModel).not.toHaveBeenCalled();
    expect(exportClient.moveNoteToDeck).not.toHaveBeenCalled();
  });
});
