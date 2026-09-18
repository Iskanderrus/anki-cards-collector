import type {
  CaptureSource,
  CollectedItem,
  LexicalUnit,
  Occurrence,
  ReviewStatus,
  SourceKind,
} from "../core/types";
import { makeContentKey, normalizeText } from "../core/normalize";

export const BACKUP_VERSION = 1 as const;

export interface BackupDocumentV1 {
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  items: CollectedItem[];
}

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

function readLexicalUnit(value: unknown, path: string): LexicalUnit {
  const record = asRecord(value, path);
  const displayText = readString(record, "displayText", path);
  const language = readString(record, "language", path);
  const normalizedText = readString(record, "normalizedText", path);
  const contentKey = readString(record, "contentKey", path);
  const ankiNoteIdValue = record.ankiNoteId;

  if (normalizeText(displayText) !== normalizedText) {
    throw new Error(`${path}.normalizedText does not match displayText.`);
  }
  if (makeContentKey(displayText, language) !== contentKey) {
    throw new Error(`${path}.contentKey does not match expression and language.`);
  }
  if (
    ankiNoteIdValue !== undefined &&
    (!Number.isInteger(ankiNoteIdValue) || (ankiNoteIdValue as number) < 0)
  ) {
    throw new Error(`${path}.ankiNoteId must be a non-negative integer when present.`);
  }

  return {
    id: readString(record, "id", path),
    contentKey,
    displayText,
    normalizedText,
    language,
    note: readString(record, "note", path),
    status: readReviewStatus(record, path),
    createdAt: readDate(record, "createdAt", path),
    updatedAt: readDate(record, "updatedAt", path),
    ...(ankiNoteIdValue === undefined ? {} : { ankiNoteId: ankiNoteIdValue as number }),
  };
}

function readOccurrence(value: unknown, path: string): Occurrence {
  const record = asRecord(value, path);
  return {
    id: readString(record, "id", path),
    lexicalUnitId: readString(record, "lexicalUnitId", path),
    context: readString(record, "context", path),
    source: readSource(record.source, `${path}.source`),
    capturedAt: readDate(record, "capturedAt", path),
  };
}

export function serializeBackup(
  items: CollectedItem[],
  exportedAt = new Date().toISOString(),
): string {
  const document: BackupDocumentV1 = {
    version: BACKUP_VERSION,
    exportedAt,
    items,
  };
  return JSON.stringify(document, null, 2);
}

export function parseBackup(raw: string): BackupDocumentV1 {
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
  if (version !== BACKUP_VERSION) {
    throw new Error(`Backup version ${version} is not supported.`);
  }

  const exportedAt = readDate(root, "exportedAt", "Backup");
  if (!Array.isArray(root.items)) throw new Error("Backup.items must be an array.");

  const lexicalIds = new Set<string>();
  const contentKeys = new Set<string>();
  const occurrenceIds = new Set<string>();

  const items = root.items.map((value, index): CollectedItem => {
    const path = `Backup.items[${index}]`;
    const record = asRecord(value, path);
    const lexicalUnit = readLexicalUnit(record.lexicalUnit, `${path}.lexicalUnit`);

    if (lexicalIds.has(lexicalUnit.id)) {
      throw new Error(`Backup contains duplicate lexical unit id ${lexicalUnit.id}.`);
    }
    if (contentKeys.has(lexicalUnit.contentKey)) {
      throw new Error(`Backup contains duplicate content key ${lexicalUnit.contentKey}.`);
    }
    lexicalIds.add(lexicalUnit.id);
    contentKeys.add(lexicalUnit.contentKey);

    if (!Array.isArray(record.occurrences)) {
      throw new Error(`${path}.occurrences must be an array.`);
    }

    const occurrences = record.occurrences.map((occurrenceValue, occurrenceIndex) => {
      const occurrencePath = `${path}.occurrences[${occurrenceIndex}]`;
      const occurrence = readOccurrence(occurrenceValue, occurrencePath);

      if (occurrence.lexicalUnitId !== lexicalUnit.id) {
        throw new Error(`${occurrencePath}.lexicalUnitId does not match its lexical unit.`);
      }
      if (occurrenceIds.has(occurrence.id)) {
        throw new Error(`Backup contains duplicate occurrence id ${occurrence.id}.`);
      }
      occurrenceIds.add(occurrence.id);
      return occurrence;
    });

    return { lexicalUnit, occurrences };
  });

  return {
    version: BACKUP_VERSION,
    exportedAt,
    items,
  };
}
