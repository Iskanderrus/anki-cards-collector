export type ReviewStatus = "inbox" | "ready" | "archived";
export type SourceKind = "web" | "duolingo";
export type SourceUrlMode = "sanitized" | "query" | "none";
export type ExportProfileMode = "collector-managed" | "mapped-user-model";
export type ExportIdentityStrategy = "collector-id-field" | "collector-tag";

export type CollectorSemanticField =
  | "Prompt"
  | "Answer"
  | "Canonical"
  | "Observed"
  | "Context"
  | "Note"
  | "Source"
  | "CardKind"
  | "Why";

export type ExportFieldMapping = Partial<Record<CollectorSemanticField, string>>;

export const LEGACY_DEFAULT_PROFILE_ID = "collector-default";

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

export interface ExportProfile {
  id: string;
  name: string;
  language?: string;
  deckName: string;
  deckId?: string;
  modelName: string;
  modelId?: string;
  mode: ExportProfileMode;
  fieldMapping?: ExportFieldMapping;
  identityStrategy?: ExportIdentityStrategy;
  lastValidatedAt?: string;
}

export interface LanguageRoute {
  language: string;
  profileId: string;
}

export type ExportBindingState = "override" | "reserved" | "exported";

export interface ExportBinding {
  lexicalUnitId: string;
  profileId: string;
  state: ExportBindingState;
  ankiNoteId?: number;
  deckName?: string;
  deckId?: string;
  modelName?: string;
  modelId?: string;
  updatedAt: string;
}

export interface CollectorSettings {
  /** Legacy/manual capture-language fallback. */
  defaultLanguage: string;
  captureProfileId?: string;
  sourceUrlMode: SourceUrlMode;
  exportProfiles: ExportProfile[];
  languageRoutes: LanguageRoute[];
  fallbackProfileId: string;
}
