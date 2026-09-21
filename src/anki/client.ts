import type { CollectedItem, ExportProfile } from "../core/types";
import { proposeLearningCard } from "../learning/policy";
import { COLLECTOR_MANAGED_MODEL_NAME } from "../settings";
import {
  collectorIdentityQuery,
  collectorIdentityTag,
  mappedAnkiFields,
  mappedSemanticValues,
  validateMappedProfile,
  validateMappedTemplateCompatibility,
} from "./mapping";

interface AnkiResponse<T> {
  result: T;
  error: string | null;
}

interface AnkiTemplate {
  Front: string;
  Back: string;
}

type AnkiTemplates = Record<string, AnkiTemplate>;

export type RawAnkiObjectId = string | number;
export type RawAnkiNamedIds = Record<string, RawAnkiObjectId>;
export type RawAnkiFieldsOnTemplates = Record<string, [string[], string[]]>;
export interface RawAnkiModelStyling {
  css: string;
}

function isMissingNoteError(error: unknown, noteId: number): boolean {
  return error instanceof Error
    && error.message.trim().toLowerCase() === `note was not found: ${noteId}`.toLowerCase();
}

const COLLECTOR_FIELDS = [
  "CollectorID",
  "Prompt",
  "Answer",
  "CardKind",
  "Why",
  "Canonical",
  "Observed",
  "Expression",
  "Context",
  "Note",
  "Source",
] as const;

const LEGACY_FRONT = "{{Expression}}";
const LEGACY_BACK = "{{FrontSide}}<hr id=answer><div class=context>{{Context}}</div><div class=context>{{Note}}</div><div class=context>{{Source}}</div>";
const POLICY_FRONT = "{{Prompt}}";
const POLICY_BACK = "{{FrontSide}}<hr id=answer><div class=answer>{{Answer}}</div><div class=context>{{Context}}</div><div class=context>{{Note}}</div><div class=meta>{{CardKind}} · {{Why}}</div><div class=context>{{Source}}</div>";
const COLLECTOR_CSS = ".card { font-family: sans-serif; font-size: 22px; text-align: left; } .answer { margin-top: 16px; font-weight: 650; } .context { margin-top: 16px; font-size: 16px; opacity: .78; } .meta { margin-top: 16px; font-size: 12px; opacity: .58; }";

export class AnkiClient {
  constructor(
    private readonly endpoint = "http://127.0.0.1:8765",
    private readonly fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
  ) {}

  private async invoke<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params }),
    });

    if (!response.ok) throw new Error(`AnkiConnect returned HTTP ${response.status}.`);

    const body = await response.json() as AnkiResponse<T>;
    if (body.error) throw new Error(body.error);
    return body.result;
  }

  async ping(): Promise<number> {
    return this.invoke<number>("version");
  }

  async deckNamesAndIds(): Promise<RawAnkiNamedIds> {
    return this.invoke<RawAnkiNamedIds>("deckNamesAndIds");
  }

  async modelNamesAndIds(): Promise<RawAnkiNamedIds> {
    return this.invoke<RawAnkiNamedIds>("modelNamesAndIds");
  }

  async modelFieldNames(modelName: string): Promise<string[]> {
    return this.invoke<string[]>("modelFieldNames", { modelName });
  }

  async modelFieldsOnTemplates(modelName: string): Promise<RawAnkiFieldsOnTemplates> {
    return this.invoke<RawAnkiFieldsOnTemplates>("modelFieldsOnTemplates", { modelName });
  }

  async modelTemplates(modelName: string): Promise<AnkiTemplates> {
    return this.invoke<AnkiTemplates>("modelTemplates", { modelName });
  }

  async modelStyling(modelName: string): Promise<RawAnkiModelStyling> {
    return this.invoke<RawAnkiModelStyling>("modelStyling", { modelName });
  }

  async findCards(query: string): Promise<RawAnkiObjectId[]> {
    return this.invoke<RawAnkiObjectId[]>("findCards", { query });
  }

  async cardsInfo(cards: RawAnkiObjectId[]): Promise<unknown[]> {
    return this.invoke<unknown[]>("cardsInfo", { cards });
  }

  async ensureDeckAndModel(profile: ExportProfile): Promise<void> {
    if (
      profile.mode === "collector-managed"
      && profile.modelName !== COLLECTOR_MANAGED_MODEL_NAME
    ) {
      throw new Error(
        `Collector refuses to modify Anki note type "${profile.modelName}" because it is not the recognized Collector-managed model.`,
      );
    }

    if (profile.mode === "mapped-user-model") {
      validateMappedProfile(profile);

      const [decks, models] = await Promise.all([
        this.deckNamesAndIds(),
        this.modelNamesAndIds(),
      ]);
      const deckId = decks[profile.deckName];
      if (deckId === undefined) {
        throw new Error(
          `Anki deck "${profile.deckName}" is not available. Refresh the live catalog and choose an existing deck.`,
        );
      }
      if (String(deckId) !== profile.deckId) {
        throw new Error(
          `Saved Anki deck identity for "${profile.deckName}" no longer matches the live deck. Refresh and re-confirm this export profile before writing.`,
        );
      }

      const modelId = models[profile.modelName];
      if (modelId === undefined) {
        throw new Error(
          `Anki note type "${profile.modelName}" is not available. Refresh the live catalog and choose an existing note type.`,
        );
      }
      if (String(modelId) !== profile.modelId) {
        throw new Error(
          `Saved Anki note-type identity for "${profile.modelName}" no longer matches the live model. Refresh and re-confirm this export profile before writing.`,
        );
      }

      const fields = await this.invoke<string[]>("modelFieldNames", {
        modelName: profile.modelName,
      });
      validateMappedProfile(profile, fields);

      const fieldsOnTemplates = await this.invoke<RawAnkiFieldsOnTemplates>(
        "modelFieldsOnTemplates",
        { modelName: profile.modelName },
      );
      const templates = await this.invoke<AnkiTemplates>("modelTemplates", {
        modelName: profile.modelName,
      });
      validateMappedTemplateCompatibility(profile, fieldsOnTemplates, templates);
      return;
    }

    const decks = await this.invoke<string[]>("deckNames");
    if (!decks.includes(profile.deckName)) {
      throw new Error(
        `Anki deck "${profile.deckName}" is not available. Refresh the live catalog, choose an existing deck, or create this saved deck explicitly.`,
      );
    }

    const models = await this.invoke<string[]>("modelNames");
    if (!models.includes(profile.modelName)) {
      await this.invoke("createModel", {
        modelName: profile.modelName,
        inOrderFields: [...COLLECTOR_FIELDS],
        css: COLLECTOR_CSS,
        isCloze: false,
        cardTemplates: [{
          Name: "Recognition",
          Front: POLICY_FRONT,
          Back: POLICY_BACK,
        }],
      });
      return;
    }

    const fields = await this.invoke<string[]>("modelFieldNames", { modelName: profile.modelName });
    for (const fieldName of COLLECTOR_FIELDS) {
      if (!fields.includes(fieldName)) {
        await this.invoke("modelFieldAdd", {
          modelName: profile.modelName,
          fieldName,
        });
      }
    }

    const templates = await this.invoke<AnkiTemplates>("modelTemplates", {
      modelName: profile.modelName,
    });
    const recognition = templates.Recognition;
    if (recognition?.Front === LEGACY_FRONT && recognition.Back === LEGACY_BACK) {
      await this.invoke("updateModelTemplates", {
        model: {
          name: profile.modelName,
          templates: {
            Recognition: {
              Front: POLICY_FRONT,
              Back: POLICY_BACK,
            },
          },
        },
      });
      await this.invoke("updateModelStyling", {
        model: {
          name: profile.modelName,
          css: COLLECTOR_CSS,
        },
      });
    }
  }

  async preflight(item: CollectedItem, profile: ExportProfile): Promise<void> {
    if (profile.mode !== "mapped-user-model") return;

    validateMappedProfile(profile);
    const proposal = proposeLearningCard(item);
    if (!proposal.recommended) {
      throw new Error(proposal.warning ?? "This item needs review before export.");
    }

    const fields = mappedAnkiFields(item, profile);
    const identityTag = collectorIdentityTag(item.lexicalUnit.id);
    const candidate = {
      deckName: profile.deckName,
      modelName: profile.modelName,
      fields,
      options: { allowDuplicate: true },
      tags: [
        "anki-cards-collector",
        `collector::${proposal.cardKind}`,
        identityTag,
      ],
    };

    const canAdd = await this.invoke<boolean[]>("canAddNotes", {
      notes: [candidate],
    });
    if (canAdd.length !== 1 || canAdd[0] !== true) {
      throw new Error(
        `Mapped export for "${item.lexicalUnit.canonicalText}" cannot produce an Anki card with the confirmed field mapping. Review the note-type template and mapping before exporting.`,
      );
    }
  }

  async upsert(
    item: CollectedItem,
    profile: ExportProfile,
    existingNoteId?: number,
  ): Promise<number> {
    const proposal = proposeLearningCard(item);
    if (!proposal.recommended) {
      throw new Error(proposal.warning ?? "This item needs review before export.");
    }

    const semanticValues = mappedSemanticValues(item);
    const fields = profile.mode === "mapped-user-model"
      ? mappedAnkiFields(item, profile)
      : {
          CollectorID: item.lexicalUnit.id,
          Prompt: semanticValues.Prompt,
          Answer: semanticValues.Answer,
          CardKind: semanticValues.CardKind,
          Why: semanticValues.Why,
          Canonical: semanticValues.Canonical,
          Observed: semanticValues.Observed,
          Expression: item.lexicalUnit.canonicalText,
          Context: semanticValues.Context,
          Note: semanticValues.Note,
          Source: semanticValues.Source,
        };
    const identityTag = collectorIdentityTag(item.lexicalUnit.id);

    let noteId = existingNoteId ?? item.lexicalUnit.ankiNoteId;

    if (noteId !== undefined) {
      const storedNoteId = noteId;
      try {
        const notes = await this.invoke<Array<{ noteId?: number; modelName?: string }>>(
          "notesInfo",
          { notes: [storedNoteId] },
        );
        const storedNote = notes.find((note) => note.noteId === storedNoteId);
        if (!storedNote) {
          noteId = undefined;
        } else if (profile.mode === "mapped-user-model") {
          if (!storedNote.modelName) {
            throw new Error(
              `Pinned Anki note ${storedNoteId} did not report its note type; Collector will not update a user-owned note without verifying model identity.`,
            );
          }
          if (storedNote.modelName !== profile.modelName) {
            throw new Error(
              `Pinned Anki note ${storedNoteId} uses note type "${storedNote.modelName}", not "${profile.modelName}".`,
            );
          }
        }
      } catch (error) {
        if (!isMissingNoteError(error, storedNoteId)) throw error;
        noteId = undefined;
      }
    }

    if (noteId === undefined) {
      const found = await this.invoke<number[]>("findNotes", {
        query: profile.mode === "mapped-user-model"
          ? collectorIdentityQuery(item.lexicalUnit.id)
          : `CollectorID:${item.lexicalUnit.id}`,
      });
      if (found.length > 1) {
        throw new Error(
          `Multiple Anki notes match Collector identity ${item.lexicalUnit.id}; resolve the duplicate identity before exporting.`,
        );
      }
      noteId = found[0];

      if (noteId !== undefined && profile.mode === "mapped-user-model") {
        const recovered = await this.invoke<Array<{ noteId?: number; modelName?: string }>>(
          "notesInfo",
          { notes: [noteId] },
        );
        const recoveredNote = recovered.find((note) => note.noteId === noteId);
        if (!recoveredNote) {
          throw new Error(
            `Anki identity lookup returned note ${noteId}, but the note could not be inspected.`,
          );
        }
        if (!recoveredNote.modelName) {
          throw new Error(
            `Recovered Anki note ${noteId} did not report its note type; Collector will not update it without verifying model identity.`,
          );
        }
        if (recoveredNote.modelName !== profile.modelName) {
          throw new Error(
            `Collector identity tag belongs to note type "${recoveredNote.modelName}", not "${profile.modelName}".`,
          );
        }
      }
    }

    if (noteId !== undefined) {
      if (profile.mode === "mapped-user-model") {
        // Establish the stable recovery identity before field mutation. If the
        // subsequent update fails, a reserved local binding can safely retry by
        // this tag without creating a duplicate note.
        await this.invoke("addTags", {
          notes: [noteId],
          tags: identityTag,
        });
      }
      await this.invoke("updateNoteFields", {
        note: { id: noteId, fields },
      });
      return noteId;
    }

    return this.invoke<number>("addNote", {
      note: {
        deckName: profile.deckName,
        modelName: profile.modelName,
        fields,
        // Collector identity for user-owned models lives in the reserved
        // tag, not necessarily in the model's first field. Allow equal prompt
        // values there so unrelated notes do not block a valid Collector note.
        options: { allowDuplicate: profile.mode === "mapped-user-model" },
        tags: [
          "anki-cards-collector",
          `collector::${proposal.cardKind}`,
          ...(profile.mode === "mapped-user-model" ? [identityTag] : []),
        ],
      },
    });
  }

  async createDeck(deckName: string): Promise<number> {
    const normalized = deckName.trim();
    if (!normalized) throw new Error("Deck name cannot be empty.");
    return this.invoke<number>("createDeck", { deck: normalized });
  }

  async moveNoteToDeck(noteId: number, deckName: string): Promise<void> {
    const cards = await this.findCards(`nid:${noteId}`);
    if (cards.length === 0) {
      throw new Error(`No Anki cards were found for note ${noteId}.`);
    }
    await this.invoke("changeDeck", { cards, deck: deckName });
  }
}
