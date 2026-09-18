import type {
  CaptureSource,
  CollectedItem,
  LexicalUnit,
  Occurrence,
  ReviewStatus,
  SourceKind,
} from "../core/types";
import { makeContentKey, normalizeIdentityText, normalizeText } from "../core/normalize";

export const BACKUP_VERSION = 2 as const;

export interface BackupDocumentV2 {
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  items: CollectedItem[];
}

export type BackupDocument = BackupDocumentV2;

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`${path}.${key} must be a string.`);
  return value;
}

function readDate(record: Record<string, unknown>, key: string, path: string): string {
  const value = readString(record, key, path);
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${path}.${key} must be a valid date.`);
  }
  return value;
}

function readReviewStatus(record: Record<string, unknown>, path: string): ReviewStatus {
  const value = readString(record, "status", path);
  if (value !== "inbox" && value !== "ready" && value !== "archived") {
    throw new Error(`${path}.status is not supported.`);
  }
  return value;
}

function readSourceKind(record: Record<string, unknown>, path: string): SourceKind {
  const value = readString(record, "kind", path);
  if (value !== "web" && value !== "duolingo") {
    throw new Error(`${path}.kind is not supported.`);
  }
  return value;
}

function readSource(value: unknown, path: string): CaptureSource {
  const record = asRecord(value, path);
  return {
    kind: readSourceKind(record, path),
    adapter: readString(record, "adapter", path),
    url: readString(record, "url", path),
    title: readString(record, "title", path),
  };
}

function readOptionalAnkiNoteId(record: Record<string, unknown>, path: string): number | undefined {
  const value = record.ankiNoteId;
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${path}.ankiNoteId must be a non-negative integer when present.`);
  }
  return value as number;
}

function readLexicalUnitV2(value: unknown, path: string): LexicalUnit {
  const record = asRecord(value, path);
  const canonicalText = readString(record, "canonicalText", path);
  const normalizedCanonicalText = readString(record, "normalizedCanonicalText", path);
  const language = readString(record, "language", path);
  const contentKey = readString(record, "contentKey", path);
  const ankiNoteId = readOptionalAnkiNoteId(record, path);

  if (normalizeIdentityText(canonicalText) !== normalizedCanonicalText) {
    throw new Error(`${path}.normalizedCanonicalText does not match canonicalText.`);
  }
  if (makeContentKey(canonicalText, language) !== contentKey) {
    throw new Error(`${path}.contentKey does not match canonical form and language.`);
  }

  return {
    id: readString(record, "id", path),
    contentKey,
    canonicalText,
    normalizedCanonicalText,
    language,
    note: readString(record, "note", path),
    status: readReviewStatus(record, path),
    createdAt: readDate(record, "createdAt", path),
    updatedAt: readDate(record, "updatedAt", path),
    ...(ankiNoteId === undefined ? {} : { ankiNoteId }),
  };
}

function readOccurrenceV2(value: unknown, path: string): Occurrence {
  const record = asRecord(value, path);
  const surfaceText = readString(record, "surfaceText", path);
  const normalizedSurfaceText = readString(record, "normalizedSurfaceText", path);

  if (normalizeIdentityText(surfaceText) !== normalizedSurfaceText) {
    throw new Error(`${path}.normalizedSurfaceText does not match surfaceText.`);
  }

  return {
    id: readString(record, "id", path),
    lexicalUnitId: readString(record, "lexicalUnitId", path),
    surfaceText,
    normalizedSurfaceText,
    context: readString(record, "context", path),
    source: readSource(record.source, `${path}.source`),
    capturedAt: readDate(record, "capturedAt", path),
  };
}

function readLegacyV1Item(value: unknown, path: string): CollectedItem {
  const record = asRecord(value, path);
  const legacyUnit = asRecord(record.lexicalUnit, `${path}.lexicalUnit`);
  const canonicalText = readString(legacyUnit, "displayText", `${path}.lexicalUnit`);
  const language = readString(legacyUnit, "language", `${path}.lexicalUnit`);
  const legacyNormalized = readString(legacyUnit, "normalizedText", `${path}.lexicalUnit`);
  const contentKey = readString(legacyUnit, "contentKey", `${path}.lexicalUnit`);
  const ankiNoteId = readOptionalAnkiNoteId(legacyUnit, `${path}.lexicalUnit`);

  if (normalizeText(canonicalText) !== legacyNormalized) {
    throw new Error(`${path}.lexicalUnit.normalizedText does not match displayText.`);
  }
  if (makeContentKey(canonicalText, language) !== contentKey) {
    throw new Error(`${path}.lexicalUnit.contentKey does not match expression and language.`);
  }

  const lexicalUnit: LexicalUnit = {
    id: readString(legacyUnit, "id", `${path}.lexicalUnit`),
    contentKey,
    canonicalText,
    normalizedCanonicalText: normalizeIdentityText(canonicalText),
    language,
    note: readString(legacyUnit, "note", `${path}.lexicalUnit`),
    status: readReviewStatus(legacyUnit, `${path}.lexicalUnit`),
    createdAt: readDate(legacyUnit, "createdAt", `${path}.lexicalUnit`),
    updatedAt: readDate(legacyUnit, "updatedAt", `${path}.lexicalUnit`),
    ...(ankiNoteId === undefined ? {} : { ankiNoteId }),
  };

  if (!Array.isArray(record.occurrences)) {
    throw new Error(`${path}.occurrences must be an array.`);
  }

  const occurrences = record.occurrences.map((occurrenceValue, index): Occurrence => {
    const occurrencePath = `${path}.occurrences[${index}]`;
    const legacyOccurrence = asRecord(occurrenceValue, occurrencePath);
    const lexicalUnitId = readString(legacyOccurrence, "lexicalUnitId", occurrencePath);

    return {
      id: readString(legacyOccurrence, "id", occurrencePath),
      lexicalUnitId,
      surfaceText: canonicalText,
      normalizedSurfaceText: normalizeIdentityText(canonicalText),
      context: readString(legacyOccurrence, "context", occurrencePath),
      source: readSource(legacyOccurrence.source, `${occurrencePath}.source`),
      capturedAt: readDate(legacyOccurrence, "capturedAt", occurrencePath),
    };
  });

  return { lexicalUnit, occurrences };
}

function validateItems(items: CollectedItem[]): CollectedItem[] {
  const lexicalIds = new Set<string>();
  const contentKeys = new Set<string>();
  const occurrenceIds = new Set<string>();

  for (const item of items) {
    if (lexicalIds.has(item.lexicalUnit.id)) {
      throw new Error(`Backup contains duplicate lexical unit id ${item.lexicalUnit.id}.`);
    }
    if (contentKeys.has(item.lexicalUnit.contentKey)) {
      throw new Error(`Backup contains duplicate content key ${item.lexicalUnit.contentKey}.`);
    }
    lexicalIds.add(item.lexicalUnit.id);
    contentKeys.add(item.lexicalUnit.contentKey);

    for (const occurrence of item.occurrences) {
      if (occurrence.lexicalUnitId !== item.lexicalUnit.id) {
        throw new Error(`Occurrence ${occurrence.id} does not match its lexical unit.`);
      }
      if (occurrenceIds.has(occurrence.id)) {
        throw new Error(`Backup contains duplicate occurrence id ${occurrence.id}.`);
      }
      occurrenceIds.add(occurrence.id);
    }
  }

  return items;
}

export function serializeBackup(
  items: CollectedItem[],
  exportedAt = new Date().toISOString(),
): string {
  const document: BackupDocumentV2 = {
    version: BACKUP_VERSION,
    exportedAt,
    items,
  };
  return JSON.stringify(document, null, 2);
}

export function parseBackup(raw: string): BackupDocumentV2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Backup is not valid JSON.");
  }

  const root = asRecord(parsed, "Backup");
  const version = root.version;

  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new Error("Backup.version must be an integer.");
  }
  if (version > BACKUP_VERSION) {
    throw new Error(
      `Backup version ${version} is newer than this extension supports (version ${BACKUP_VERSION}).`,
    );
  }
  if (version !== 1 && version !== BACKUP_VERSION) {
    throw new Error(`Backup version ${version} is not supported.`);
  }

  const exportedAt = readDate(root, "exportedAt", "Backup");
  if (!Array.isArray(root.items)) throw new Error("Backup.items must be an array.");

  const items = version === 1
    ? root.items.map((value, index) => readLegacyV1Item(value, `Backup.items[${index}]`))
    : root.items.map((value, index): CollectedItem => {
        const path = `Backup.items[${index}]`;
        const record = asRecord(value, path);
        const lexicalUnit = readLexicalUnitV2(record.lexicalUnit, `${path}.lexicalUnit`);

        if (!Array.isArray(record.occurrences)) {
          throw new Error(`${path}.occurrences must be an array.`);
        }

        const occurrences = record.occurrences.map((occurrenceValue, occurrenceIndex) =>
          readOccurrenceV2(occurrenceValue, `${path}.occurrences[${occurrenceIndex}]`),
        );

        return { lexicalUnit, occurrences };
      });

  return {
    version: BACKUP_VERSION,
    exportedAt,
    items: validateItems(items),
  };
}
