#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const DEFAULT_ENDPOINT = "http://127.0.0.1:8765";

function fail(message) {
  throw new Error(message);
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\\s+/g, " ").trim();
}

function normalizeIdentityText(value) {
  return normalizeText(value).toLocaleLowerCase();
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function requireVersion(document, expected, label) {
  if (document.version !== expected) {
    fail(label + " must be backup version " + expected + "; got " + document.version + ".");
  }
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mapById(items, label) {
  const result = new Map();
  for (const item of items ?? []) {
    const id = item?.lexicalUnit?.id;
    if (!id) fail(label + " contains an item without lexicalUnit.id.");
    if (result.has(id)) fail(label + " contains duplicate lexicalUnit.id " + id + ".");
    result.set(id, item);
  }
  return result;
}

function occurrenceMap(item, label) {
  const result = new Map();
  for (const occurrence of item.occurrences ?? []) {
    if (!occurrence?.id) fail(label + " contains an occurrence without id.");
    if (result.has(occurrence.id)) fail(label + " contains duplicate occurrence id " + occurrence.id + ".");
    result.set(occurrence.id, occurrence);
  }
  return result;
}

export function verifyCorpusMigration(before, after) {
  requireVersion(before, 1, "Before backup");
  requireVersion(after, 2, "After backup");

  const beforeItems = mapById(before.items, "Before backup");
  const afterItems = mapById(after.items, "After backup");
  if (beforeItems.size !== afterItems.size) {
    fail("Lexical unit count changed: before=" + beforeItems.size + ", after=" + afterItems.size + ".");
  }

  let occurrenceCountBefore = 0;
  let occurrenceCountAfter = 0;

  for (const [id, oldItem] of beforeItems) {
    const nextItem = afterItems.get(id);
    if (!nextItem) fail("Lexical unit " + id + " is missing after migration.");

    const oldUnit = oldItem.lexicalUnit;
    const nextUnit = nextItem.lexicalUnit;
    const checks = [
      ["contentKey", oldUnit.contentKey, nextUnit.contentKey],
      ["canonicalText", oldUnit.displayText, nextUnit.canonicalText],
      ["normalizedCanonicalText", normalizeIdentityText(oldUnit.displayText), nextUnit.normalizedCanonicalText],
      ["language", oldUnit.language, nextUnit.language],
      ["note", oldUnit.note, nextUnit.note],
      ["status", oldUnit.status, nextUnit.status],
      ["createdAt", oldUnit.createdAt, nextUnit.createdAt],
      ["updatedAt", oldUnit.updatedAt, nextUnit.updatedAt],
      ["ankiNoteId", oldUnit.ankiNoteId, nextUnit.ankiNoteId],
    ];

    for (const [field, expected, actual] of checks) {
      if (!equalJson(expected, actual)) {
        fail("Lexical unit " + id + " changed " + field + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ".");
      }
    }

    const oldOccurrences = occurrenceMap(oldItem, "Before item " + id);
    const nextOccurrences = occurrenceMap(nextItem, "After item " + id);
    occurrenceCountBefore += oldOccurrences.size;
    occurrenceCountAfter += nextOccurrences.size;

    if (oldOccurrences.size !== nextOccurrences.size) {
      fail("Occurrence count changed for " + id + ": before=" + oldOccurrences.size + ", after=" + nextOccurrences.size + ".");
    }

    for (const [occurrenceId, oldOccurrence] of oldOccurrences) {
      const nextOccurrence = nextOccurrences.get(occurrenceId);
      if (!nextOccurrence) fail("Occurrence " + occurrenceId + " is missing after migration.");

      const occurrenceChecks = [
        ["lexicalUnitId", oldOccurrence.lexicalUnitId, nextOccurrence.lexicalUnitId],
        ["surfaceText", oldUnit.displayText, nextOccurrence.surfaceText],
        ["normalizedSurfaceText", normalizeIdentityText(oldUnit.displayText), nextOccurrence.normalizedSurfaceText],
        ["context", oldOccurrence.context, nextOccurrence.context],
        ["source", oldOccurrence.source, nextOccurrence.source],
        ["capturedAt", oldOccurrence.capturedAt, nextOccurrence.capturedAt],
      ];

      for (const [field, expected, actual] of occurrenceChecks) {
        if (!equalJson(expected, actual)) {
          fail("Occurrence " + occurrenceId + " changed " + field + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ".");
        }
      }
    }
  }

  return {
    lexicalUnits: beforeItems.size,
    occurrences: occurrenceCountBefore,
    occurrenceCountAfter,
  };
}

async function invokeAnki(endpoint, action, params = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: 6, params }),
  });

  if (!response.ok) fail("AnkiConnect returned HTTP " + response.status + " for " + action + ".");
  const body = await response.json();
  if (body.error) fail("AnkiConnect " + action + ": " + body.error);
  return body.result;
}

function schedulingFingerprint(card) {
  return {
    cardId: card.cardId,
    reps: card.reps,
    lapses: card.lapses,
    interval: card.interval,
    factor: card.factor,
  };
}

function requireExistingAnkiNote(notes, noteId, label = "Anki note") {
  const note = (notes ?? []).find((candidate) => candidate?.noteId === noteId);
  if (!note) {
    fail(label + " " + noteId + " does not exist or notesInfo returned no matching note object.");
  }
  return note;
}

function findItem(document, version, collectorId, label) {
  requireVersion(document, version, label);
  const item = (document.items ?? []).find((candidate) => candidate?.lexicalUnit?.id === collectorId);
  if (!item) fail("Collector ID " + collectorId + " is not present in " + label + ".");
  return item;
}

async function listCandidates(beforePath) {
  const before = await readJson(beforePath);
  requireVersion(before, 1, "Before backup");
  const candidates = (before.items ?? [])
    .filter((item) => item?.lexicalUnit?.ankiNoteId !== undefined)
    .map((item) => ({
      collectorId: item.lexicalUnit.id,
      expression: item.lexicalUnit.displayText,
      status: item.lexicalUnit.status,
      ankiNoteId: item.lexicalUnit.ankiNoteId,
      occurrences: item.occurrences?.length ?? 0,
    }));
  console.table(candidates);
}

async function snapshot(beforePath, collectorId, outputPath, endpoint = DEFAULT_ENDPOINT) {
  const before = await readJson(beforePath);
  const item = findItem(before, 1, collectorId, "Before backup");
  const noteId = item.lexicalUnit.ankiNoteId;
  if (noteId === undefined) fail("Collector ID " + collectorId + " has no ankiNoteId.");

  await invokeAnki(endpoint, "version");
  const notes = await invokeAnki(endpoint, "notesInfo", { notes: [noteId] });
  const note = requireExistingAnkiNote(notes, noteId);

  if (!Array.isArray(note.cards) || note.cards.length === 0) {
    fail("Anki note " + noteId + " has no card IDs; refusing to write an invalid migration snapshot.");
  }

  const cards = await invokeAnki(endpoint, "cardsInfo", { cards: note.cards });
  const snapshotDocument = {
    collectorId,
    noteId: note.noteId,
    modelName: note.modelName,
    cardIds: [...(note.cards ?? [])],
    scheduling: cards.map(schedulingFingerprint),
  };

  await writeFile(outputPath, JSON.stringify(snapshotDocument, null, 2) + "\n", "utf8");
  console.log("Saved Anki snapshot to " + outputPath + ".");
  console.table(snapshotDocument.scheduling);
}

async function verify(beforePath, afterPath, snapshotPath, endpoint = DEFAULT_ENDPOINT) {
  const before = await readJson(beforePath);
  const after = await readJson(afterPath);
  const snapshotDocument = await readJson(snapshotPath);
  const corpus = verifyCorpusMigration(before, after);

  const beforeItem = findItem(before, 1, snapshotDocument.collectorId, "Before backup");
  const afterItem = findItem(after, 2, snapshotDocument.collectorId, "After backup");

  if (beforeItem.lexicalUnit.ankiNoteId !== afterItem.lexicalUnit.ankiNoteId) {
    fail("ankiNoteId changed across migration.");
  }
  if (afterItem.lexicalUnit.ankiNoteId !== snapshotDocument.noteId) {
    fail("Snapshot note ID does not match migrated ankiNoteId.");
  }

  await invokeAnki(endpoint, "version");
  const notes = await invokeAnki(endpoint, "notesInfo", { notes: [snapshotDocument.noteId] });
  const note = requireExistingAnkiNote(notes, snapshotDocument.noteId);

  if (!equalJson(note.cards ?? [], snapshotDocument.cardIds ?? [])) {
    fail("Anki card IDs changed.");
  }
  if (note.modelName !== snapshotDocument.modelName) {
    fail("Anki model changed from " + snapshotDocument.modelName + " to " + note.modelName + ".");
  }

  const cards = await invokeAnki(endpoint, "cardsInfo", { cards: note.cards ?? [] });
  const afterScheduling = cards.map(schedulingFingerprint);
  if (!equalJson(afterScheduling, snapshotDocument.scheduling ?? [])) {
    fail("Anki scheduling counters changed. Do not study the target card between snapshot and verification.");
  }

  const latestOccurrence = afterItem.occurrences?.at(-1);
  const expectedFields = {
    CollectorID: snapshotDocument.collectorId,
    Canonical: afterItem.lexicalUnit.canonicalText,
    Observed: latestOccurrence?.surfaceText ?? afterItem.lexicalUnit.canonicalText,
  };

  for (const [field, expected] of Object.entries(expectedFields)) {
    const actual = note.fields?.[field]?.value;
    if (actual !== expected) {
      fail("Anki field " + field + " mismatch. Re-export the target item before final verification.");
    }
  }

  console.log("PASS: real v1 -> v2 corpus migration preserved IDs, state, sources, contexts, and occurrences.");
  console.log("PASS: Anki note ID and card IDs are unchanged.");
  console.log("PASS: Anki scheduling counters are unchanged.");
  console.log("PASS: Canonical / Observed / CollectorID fields match the migrated corpus.");
  console.log("Verified " + corpus.lexicalUnits + " lexical units and " + corpus.occurrences + " occurrences.");
}

function selfTest() {
  const before = {
    version: 1,
    items: [{
      lexicalUnit: {
        id: "unit-1",
        contentKey: "es::aunque",
        displayText: "aunque",
        normalizedText: "aunque",
        language: "es",
        note: "note",
        status: "ready",
        createdAt: "2026-09-18T10:00:00Z",
        updatedAt: "2026-09-18T11:00:00Z",
        ankiNoteId: 42,
      },
      occurrences: [{
        id: "occ-1",
        lexicalUnitId: "unit-1",
        context: "Aunque llueva, voy.",
        source: { kind: "web", adapter: "generic-web", url: "https://example.com", title: "Example" },
        capturedAt: "2026-09-18T10:00:00Z",
      }],
    }],
  };

  const after = {
    version: 2,
    items: [{
      lexicalUnit: {
        id: "unit-1",
        contentKey: "es::aunque",
        canonicalText: "aunque",
        normalizedCanonicalText: "aunque",
        language: "es",
        note: "note",
        status: "ready",
        createdAt: "2026-09-18T10:00:00Z",
        updatedAt: "2026-09-18T11:00:00Z",
        ankiNoteId: 42,
      },
      occurrences: [{
        id: "occ-1",
        lexicalUnitId: "unit-1",
        surfaceText: "aunque",
        normalizedSurfaceText: "aunque",
        context: "Aunque llueva, voy.",
        source: { kind: "web", adapter: "generic-web", url: "https://example.com", title: "Example" },
        capturedAt: "2026-09-18T10:00:00Z",
      }],
    }],
  };

  const result = verifyCorpusMigration(before, after);
  if (result.lexicalUnits !== 1 || result.occurrences !== 1) fail("Self-test result is incorrect.");

  const validNote = requireExistingAnkiNote([{ noteId: 42, cards: [101] }], 42);
  if (validNote.noteId !== 42) fail("Anki note validation self-test is incorrect.");

  let rejectedEmptyNote = false;
  try {
    requireExistingAnkiNote([{}], 42);
  } catch {
    rejectedEmptyNote = true;
  }
  if (!rejectedEmptyNote) fail("Deleted-note notesInfo shape was not rejected.");

  console.log("manual-migration-check self-test passed.");
}

function usage() {
  console.log("Usage:\\n" +
    "  node scripts/manual-migration-check.mjs self-test\\n" +
    "  node scripts/manual-migration-check.mjs list-candidates BEFORE_V1.json\\n" +
    "  node scripts/manual-migration-check.mjs snapshot BEFORE_V1.json COLLECTOR_ID SNAPSHOT.json [ANKI_ENDPOINT]\\n" +
    "  node scripts/manual-migration-check.mjs verify-corpus BEFORE_V1.json AFTER_V2.json\\n" +
    "  node scripts/manual-migration-check.mjs verify BEFORE_V1.json AFTER_V2.json SNAPSHOT.json [ANKI_ENDPOINT]");
}

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "self-test") {
    selfTest();
  } else if (command === "list-candidates" && args.length === 1) {
    await listCandidates(args[0]);
  } else if (command === "snapshot" && args.length >= 3 && args.length <= 4) {
    await snapshot(args[0], args[1], args[2], args[3] ?? DEFAULT_ENDPOINT);
  } else if (command === "verify-corpus" && args.length === 2) {
    const result = verifyCorpusMigration(await readJson(args[0]), await readJson(args[1]));
    console.log("PASS: verified " + result.lexicalUnits + " lexical units and " + result.occurrences + " occurrences.");
  } else if (command === "verify" && args.length >= 3 && args.length <= 4) {
    await verify(args[0], args[1], args[2], args[3] ?? DEFAULT_ENDPOINT);
  } else {
    usage();
    process.exitCode = 2;
  }
} catch (error) {
  console.error("FAIL: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
