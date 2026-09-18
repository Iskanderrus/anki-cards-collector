export type ReviewStatus = "inbox" | "ready" | "archived";
export type SourceKind = "web" | "duolingo";
export type SourceUrlMode = "sanitized" | "query" | "none";

export interface CaptureSource {
  kind: SourceKind;
  adapter: string;
  url: string;
  title: string;
}

export interface CaptureDraft {
  text: string;
  context: string;
  language: string;
  source: CaptureSource;
  capturedAt: string;
}

export interface LexicalUnit {
  id: string;
  contentKey: string;
  canonicalText: string;
  normalizedCanonicalText: string;
  language: string;
  note: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  ankiNoteId?: number;
}

export interface Occurrence {
  id: string;
  lexicalUnitId: string;
  surfaceText: string;
  normalizedSurfaceText: string;
  context: string;
  source: CaptureSource;
  capturedAt: string;
}

export interface CollectedItem {
  lexicalUnit: LexicalUnit;
  occurrences: Occurrence[];
}

export interface CollectorSettings {
  defaultLanguage: string;
  deckName: string;
  modelName: string;
  sourceUrlMode: SourceUrlMode;
}
