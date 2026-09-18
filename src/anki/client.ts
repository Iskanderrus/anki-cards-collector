import type { CollectedItem, CollectorSettings } from "../core/types";

interface AnkiResponse<T> {
  result: T;
  error: string | null;
}

export class AnkiClient {
  constructor(
    private readonly endpoint = "http://127.0.0.1:8765",
    private readonly fetcher: typeof fetch = fetch,
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

  async ensureDeckAndModel(settings: CollectorSettings): Promise<void> {
    const decks = await this.invoke<string[]>("deckNames");
    if (!decks.includes(settings.deckName)) {
      await this.invoke("createDeck", { deck: settings.deckName });
    }

    const models = await this.invoke<string[]>("modelNames");
    if (!models.includes(settings.modelName)) {
      await this.invoke("createModel", {
        modelName: settings.modelName,
        inOrderFields: ["CollectorID", "Expression", "Context", "Note", "Source"],
        css: ".card { font-family: sans-serif; font-size: 22px; text-align: left; } .context { margin-top: 16px; font-size: 16px; opacity: .78; }",
        isCloze: false,
        cardTemplates: [{
          Name: "Recognition",
          Front: "{{Expression}}",
          Back: "{{FrontSide}}<hr id=answer><div class=context>{{Context}}</div><div class=context>{{Note}}</div><div class=context>{{Source}}</div>",
        }],
      });
      return;
    }

    const fields = await this.invoke<string[]>("modelFieldNames", { modelName: settings.modelName });
    if (!fields.includes("Note")) {
      await this.invoke("modelFieldAdd", {
        modelName: settings.modelName,
        fieldName: "Note",
      });
    }
  }

  async upsert(item: CollectedItem, settings: CollectorSettings): Promise<number> {
    const occurrence = item.occurrences.at(-1);
    const fields = {
      CollectorID: item.lexicalUnit.id,
      Expression: item.lexicalUnit.displayText,
      Context: occurrence?.context ?? "",
      Note: item.lexicalUnit.note,
      Source: occurrence?.source.url ?? "",
    };

    let noteId = item.lexicalUnit.ankiNoteId;

    if (noteId !== undefined) {
      const notes = await this.invoke<Array<{ noteId: number }>>("notesInfo", { notes: [noteId] });
      if (notes.length === 0) noteId = undefined;
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
        tags: ["anki-cards-collector"],
      },
    });
  }
}
