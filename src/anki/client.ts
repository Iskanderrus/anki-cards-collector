import type { CollectedItem, CollectorSettings } from "../core/types";
import { proposeLearningCard } from "../learning/policy";

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

  async ensureDeckAndModel(settings: CollectorSettings): Promise<void> {
    const decks = await this.invoke<string[]>("deckNames");
    if (!decks.includes(settings.deckName)) {
      await this.invoke("createDeck", { deck: settings.deckName });
    }

    const models = await this.invoke<string[]>("modelNames");
    if (!models.includes(settings.modelName)) {
      await this.invoke("createModel", {
        modelName: settings.modelName,
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

    const fields = await this.invoke<string[]>("modelFieldNames", { modelName: settings.modelName });
    for (const fieldName of COLLECTOR_FIELDS) {
      if (!fields.includes(fieldName)) {
        await this.invoke("modelFieldAdd", {
          modelName: settings.modelName,
          fieldName,
        });
      }
    }

    const templates = await this.invoke<AnkiTemplates>("modelTemplates", {
      modelName: settings.modelName,
    });
    const recognition = templates.Recognition;
    if (recognition?.Front === LEGACY_FRONT && recognition.Back === LEGACY_BACK) {
      await this.invoke("updateModelTemplates", {
        model: {
          name: settings.modelName,
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
          name: settings.modelName,
          css: COLLECTOR_CSS,
        },
      });
    }
  }

  async upsert(item: CollectedItem, settings: CollectorSettings): Promise<number> {
    const proposal = proposeLearningCard(item);
    if (!proposal.recommended) {
      throw new Error(proposal.warning ?? "This item needs review before export.");
    }

    const occurrence = proposal.occurrenceSelection?.occurrence;
    const fields = {
      CollectorID: item.lexicalUnit.id,
      Prompt: proposal.prompt,
      Answer: proposal.answer,
      CardKind: proposal.cardKind,
      Why: proposal.reason,
      Canonical: item.lexicalUnit.canonicalText,
      Observed: occurrence?.surfaceText ?? item.lexicalUnit.canonicalText,
      Expression: item.lexicalUnit.canonicalText,
      Context: occurrence?.context ?? "",
      Note: item.lexicalUnit.note,
      Source: occurrence?.source.url ?? "",
    };

    let noteId = item.lexicalUnit.ankiNoteId;

    if (noteId !== undefined) {
      const storedNoteId = noteId;
      try {
        const notes = await this.invoke<Array<{ noteId?: number }>>("notesInfo", { notes: [storedNoteId] });
        const storedNoteStillExists = notes.some((note) => note.noteId === storedNoteId);
        if (!storedNoteStillExists) noteId = undefined;
      } catch (error) {
        if (!isMissingNoteError(error, storedNoteId)) throw error;
        noteId = undefined;
      }
    }

    if (noteId === undefined) {
      const found = await this.invoke<number[]>("findNotes", {
        query: `CollectorID:${item.lexicalUnit.id}`,
      });
      noteId = found[0];
    }

    if (noteId !== undefined) {
      await this.invoke("updateNoteFields", {
        note: { id: noteId, fields },
      });
      return noteId;
    }

    return this.invoke<number>("addNote", {
      note: {
        deckName: settings.deckName,
        modelName: settings.modelName,
        fields,
        options: { allowDuplicate: false },
        tags: ["anki-cards-collector", `collector::${proposal.cardKind}`],
      },
    });
  }
}
