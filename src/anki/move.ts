import type {
  ExportBinding,
  ExportProfile,
} from "../core/types";

export interface ExportMoveClient {
  ensureDeckAndModel(profile: ExportProfile): Promise<void>;
  moveNoteToDeck(noteId: number, deckName: string): Promise<void>;
}

export interface MoveExportedNoteInput {
  lexicalUnitId: string;
  binding: ExportBinding;
  currentProfile: ExportProfile;
  targetProfile: ExportProfile;
}

export type PersistMovedBinding = (binding: ExportBinding) => Promise<void>;

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

export async function moveExportedNote(
  input: MoveExportedNoteInput,
  client: ExportMoveClient,
  persistBinding: PersistMovedBinding,
): Promise<ExportBinding> {
  const { lexicalUnitId, binding, currentProfile, targetProfile } = input;
  const noteId = binding.ankiNoteId;
  if (noteId === undefined) {
    throw new Error("This item has no exported Anki note to move.");
  }
  if (targetProfile.mode !== "collector-managed") {
    throw new Error("Moving to a mapped user note type requires ACCP-014.");
  }

  const currentModelName = binding.modelName ?? currentProfile.modelName;
  if (currentModelName !== targetProfile.modelName) {
    throw new Error(
      "Changing an exported note's note type requires ACCP-014 mapping. Only same-note-type deck moves are allowed here.",
    );
  }

  const originalDeckName = binding.deckName ?? currentProfile.deckName;
  if (originalDeckName === targetProfile.deckName && binding.profileId === targetProfile.id) {
    return binding;
  }

  await client.ensureDeckAndModel(targetProfile);
  await client.moveNoteToDeck(noteId, targetProfile.deckName);

  const movedBinding: ExportBinding = {
    lexicalUnitId,
    profileId: targetProfile.id,
    ankiNoteId: noteId,
    deckName: targetProfile.deckName,
    modelName: targetProfile.modelName,
    updatedAt: new Date().toISOString(),
  };

  try {
    await persistBinding(movedBinding);
  } catch (persistError) {
    try {
      await client.moveNoteToDeck(noteId, originalDeckName);
    } catch (rollbackError) {
      throw new Error(
        `Anki note ${noteId} moved to "${targetProfile.deckName}", but Collector could not save the new binding and rollback to "${originalDeckName}" also failed. Local and Anki destination state may differ. Save neither route/profile changes nor another move until this is repaired. Binding error: ${message(persistError)} Rollback error: ${message(rollbackError)}`,
      );
    }

    throw new Error(
      `Collector could not save the new destination binding, so Anki note ${noteId} was moved back to "${originalDeckName}". ${message(persistError)}`,
    );
  }

  return movedBinding;
}
