import type { BackupDocument } from "../backup/format";
import type {
  CaptureDraft,
  CollectedItem,
  ExportBinding,
  LexicalUnit,
  Occurrence,
  ReviewStatus,
} from "../core/types";
import { makeContentKey, normalizeIdentityText, normalizeLanguage, normalizeText } from "../core/normalize";
import { CollectorDatabase, db as defaultDb } from "./database";

export interface EditLexicalUnitInput {
  canonicalText: string;
  language: string;
  note: string;
  occurrenceId?: string;
  surfaceText?: string;
  context?: string;
}

export interface CaptureBatchEntry {
  draft: CaptureDraft;
  resolutionLexicalUnitId?: string;
}

export type CaptureBatchOutcomeKind = "new-unit" | "evidence-added" | "unchanged";

export interface CaptureBatchOutcome {
  kind: CaptureBatchOutcomeKind;
  item: CollectedItem;
}

export interface ObservedFormGroup {
  normalizedSurfaceText: string;
  surfaceForms: string[];
  count: number;
  occurrences: Occurrence[];
}

export type CanonicalizationPreviewKind =
  | "unchanged"
  | "rename"
  | "consolidate"
  | "conflict";

export interface CanonicalizationTargetSummary {
  id: string;
  canonicalText: string;
  language: string;
  status: ReviewStatus;
  occurrenceCount: number;
}

export interface CanonicalizationPreview {
  kind: CanonicalizationPreviewKind;
  currentId: string;
  currentCanonicalText: string;
  requestedCanonicalText: string;
  requestedLanguage: string;
  currentOccurrenceCount: number;
  willReturnToInbox: boolean;
  target?: CanonicalizationTargetSummary;
  survivingLexicalUnitId?: string;
  resultingOccurrenceCount?: number;
  preservedAnkiNoteId?: number;
  conflictReason?: string;
}

export interface RestorePreview {
  lexicalUnitsAdded: number;
  lexicalUnitsUpdated: number;
  lexicalUnitsSkipped: number;
  occurrencesAdded: number;
  occurrencesUpdated: number;
  occurrencesSkipped: number;
  exportBindingsAdded: number;
  exportBindingsSkipped: number;
  conflicts: string[];
}

interface RestorePlan {
  preview: RestorePreview;
  lexicalUnitsToAdd: LexicalUnit[];
  lexicalUnitsToUpdate: LexicalUnit[];
  occurrencesToAdd: Occurrence[];
  occurrencesToUpdate: Occurrence[];
  exportBindingsToAdd: ExportBinding[];
}

function occurrenceFingerprint(occurrence: Occurrence): string {
  return [
    occurrence.lexicalUnitId,
    occurrence.capturedAt,
    occurrence.normalizedSurfaceText,
    normalizeText(occurrence.context),
    occurrence.source.kind,
    occurrence.source.adapter,
    occurrence.source.url,
    occurrence.source.title,
  ].join("\u0000");
}

function sameOccurrence(left: Occurrence, right: Occurrence): boolean {
  return occurrenceFingerprint(left) === occurrenceFingerprint(right);
}

function combineNotes(primary: string, secondary: string): string {
  const first = primary.trim();
  const second = secondary.trim();
  if (!first) return second.slice(0, 2000);
  if (!second || first === second) return first.slice(0, 2000);
  return `${first}\n\n${second}`.slice(0, 2000);
}

function buildRestorePlan(
  backup: BackupDocument,
  localUnits: LexicalUnit[],
  localOccurrences: Occurrence[],
  localBindings: ExportBinding[],
): RestorePlan {
  const preview: RestorePreview = {
    lexicalUnitsAdded: 0,
    lexicalUnitsUpdated: 0,
    lexicalUnitsSkipped: 0,
    occurrencesAdded: 0,
    occurrencesUpdated: 0,
    occurrencesSkipped: 0,
    exportBindingsAdded: 0,
    exportBindingsSkipped: 0,
    conflicts: [],
  };
  const lexicalUnitsToAdd: LexicalUnit[] = [];
  const lexicalUnitsToUpdate: LexicalUnit[] = [];
  const occurrencesToAdd: Occurrence[] = [];
  const occurrencesToUpdate: Occurrence[] = [];
  const exportBindingsToAdd: ExportBinding[] = [];

  const unitsById = new Map(localUnits.map((unit) => [unit.id, unit]));
  const unitsByContentKey = new Map(localUnits.map((unit) => [unit.contentKey, unit]));
  const updatedUnitIds = new Set<string>();
  const conflictedUnitIds = new Set<string>();

  for (const item of backup.items) {
    const incoming = item.lexicalUnit;
    const current = unitsById.get(incoming.id);
    const contentOwner = unitsByContentKey.get(incoming.contentKey);

    if (contentOwner && contentOwner.id !== incoming.id) {
      preview.conflicts.push(
        `Canonical-form conflict: "${incoming.canonicalText}" (${incoming.language}) is already stored under another Collector ID.`,
      );
      conflictedUnitIds.add(incoming.id);
      continue;
    }

    if (!current) {
      lexicalUnitsToAdd.push(incoming);
      preview.lexicalUnitsAdded += 1;
      unitsById.set(incoming.id, incoming);
      unitsByContentKey.set(incoming.contentKey, incoming);
      updatedUnitIds.add(incoming.id);
      continue;
    }

    if (incoming.updatedAt > current.updatedAt) {
      lexicalUnitsToUpdate.push(incoming);
      preview.lexicalUnitsUpdated += 1;
      if (current.contentKey !== incoming.contentKey) {
        unitsByContentKey.delete(current.contentKey);
      }
      unitsById.set(incoming.id, incoming);
      unitsByContentKey.set(incoming.contentKey, incoming);
      updatedUnitIds.add(incoming.id);
    } else {
      preview.lexicalUnitsSkipped += 1;
    }
  }

  const occurrencesById = new Map(localOccurrences.map((occurrence) => [occurrence.id, occurrence]));
  const occurrenceFingerprints = new Set(localOccurrences.map(occurrenceFingerprint));

  for (const item of backup.items) {
    if (conflictedUnitIds.has(item.lexicalUnit.id)) continue;

    for (const incoming of item.occurrences) {
      const current = occurrencesById.get(incoming.id);

      if (current) {
        if (current.lexicalUnitId !== incoming.lexicalUnitId) {
          preview.conflicts.push(
            `Occurrence conflict: ${incoming.id} belongs to a different Collector ID locally.`,
          );
          continue;
        }

        if (updatedUnitIds.has(incoming.lexicalUnitId) && !sameOccurrence(current, incoming)) {
          occurrencesToUpdate.push(incoming);
          preview.occurrencesUpdated += 1;
          occurrenceFingerprints.delete(occurrenceFingerprint(current));
          occurrenceFingerprints.add(occurrenceFingerprint(incoming));
          occurrencesById.set(incoming.id, incoming);
        } else {
          preview.occurrencesSkipped += 1;
        }
        continue;
      }

      const fingerprint = occurrenceFingerprint(incoming);
      if (occurrenceFingerprints.has(fingerprint)) {
        preview.occurrencesSkipped += 1;
        continue;
      }

      occurrencesToAdd.push(incoming);
      preview.occurrencesAdded += 1;
      occurrenceFingerprints.add(fingerprint);
      occurrencesById.set(incoming.id, incoming);
    }
  }

  const bindingsByUnitId = new Map(
    localBindings.map((binding) => [binding.lexicalUnitId, binding]),
  );

  for (const incoming of backup.exportBindings) {
    if (conflictedUnitIds.has(incoming.lexicalUnitId)) continue;

    const current = bindingsByUnitId.get(incoming.lexicalUnitId);
    if (!current) {
      exportBindingsToAdd.push(incoming);
      preview.exportBindingsAdded += 1;
      bindingsByUnitId.set(incoming.lexicalUnitId, incoming);
      continue;
    }

    const same =
      current.profileId === incoming.profileId
      && current.state === incoming.state
      && current.ankiNoteId === incoming.ankiNoteId
      && current.deckName === incoming.deckName
      && current.deckId === incoming.deckId
      && current.modelName === incoming.modelName
      && current.modelId === incoming.modelId;

    if (same) {
      preview.exportBindingsSkipped += 1;
      continue;
    }

    preview.conflicts.push(
      `Export binding conflict: ${incoming.lexicalUnitId} already has a different local destination or Anki note.`,
    );
  }

  return {
    preview,
    lexicalUnitsToAdd,
    lexicalUnitsToUpdate,
    occurrencesToAdd,
    occurrencesToUpdate,
    exportBindingsToAdd,
  };
}

function consolidationConflictReason(
  leftUnit: LexicalUnit,
  rightUnit: LexicalUnit,
  leftBinding: ExportBinding | undefined,
  rightBinding: ExportBinding | undefined,
): string | undefined {
  if (leftBinding?.state === "reserved" || rightBinding?.state === "reserved") {
    return "Cannot consolidate these forms while an Anki export is awaiting reconciliation.";
  }

  if (
    leftBinding?.ankiNoteId !== undefined
    && rightBinding?.ankiNoteId !== undefined
    && leftBinding.ankiNoteId !== rightBinding.ankiNoteId
  ) {
    return "Cannot consolidate these forms because both are linked to different Anki notes.";
  }

  if (leftBinding && rightBinding) {
    if (leftBinding.profileId !== rightBinding.profileId) {
      return "Cannot consolidate these forms because they use different export destinations.";
    }
    if (
      leftBinding.deckName
      && rightBinding.deckName
      && leftBinding.deckName !== rightBinding.deckName
    ) {
      return "Cannot consolidate these forms because they use different export destinations.";
    }
    if (
      leftBinding.deckId
      && rightBinding.deckId
      && leftBinding.deckId !== rightBinding.deckId
    ) {
      return "Cannot consolidate these forms because they use different export destinations.";
    }
    if (
      leftBinding.modelName
      && rightBinding.modelName
      && leftBinding.modelName !== rightBinding.modelName
    ) {
      return "Cannot consolidate these forms because they use different export destinations.";
    }
    if (
      leftBinding.modelId
      && rightBinding.modelId
      && leftBinding.modelId !== rightBinding.modelId
    ) {
      return "Cannot consolidate these forms because they use different export destinations.";
    }
  }

  if (
    leftUnit.ankiNoteId !== undefined
    && rightUnit.ankiNoteId !== undefined
    && leftUnit.ankiNoteId !== rightUnit.ankiNoteId
  ) {
    return "Cannot consolidate these forms because both are linked to different Anki notes.";
  }

  return undefined;
}

function bindingPriority(binding: ExportBinding | undefined): number {
  if (!binding) return -1;
  if (binding.state === "exported") return 3;
  if (binding.state === "reserved") return 2;
  return 1;
}

function preferredBinding(
  primary: ExportBinding | undefined,
  secondary: ExportBinding | undefined,
  lexicalUnitId: string,
): ExportBinding | undefined {
  const source =
    bindingPriority(primary) >= bindingPriority(secondary)
      ? primary ?? secondary
      : secondary ?? primary;
  return source ? { ...source, lexicalUnitId } : undefined;
}

export class CaptureRepository {
  constructor(private readonly database: CollectorDatabase = defaultDb) {}

  private async findUniqueUnitByObservedSurface(
    normalizedSurfaceText: string,
    language: string,
  ): Promise<LexicalUnit | undefined> {
    const occurrences = await this.database.occurrences
      .where("normalizedSurfaceText")
      .equals(normalizedSurfaceText)
      .toArray();

    const ids = [...new Set(occurrences.map((occurrence) => occurrence.lexicalUnitId))];
    if (ids.length === 0) return undefined;

    const units = (await this.database.lexicalUnits.bulkGet(ids))
      .filter((unit): unit is LexicalUnit => unit !== undefined)
      .filter((unit) => normalizeLanguage(unit.language) === normalizeLanguage(language));

    return units.length === 1 ? units[0] : undefined;
  }

  private async captureWithinTransaction(
    draft: CaptureDraft,
    targetLexicalUnitId?: string,
  ): Promise<LexicalUnit> {
    const surfaceText = normalizeText(draft.text);
    if (!surfaceText) throw new Error("Nothing selected.");

    const normalizedSurfaceText = normalizeIdentityText(surfaceText);
    const language = normalizeLanguage(draft.language);
    const directContentKey = makeContentKey(surfaceText, language);
    const now = draft.capturedAt || new Date().toISOString();
    let lexicalUnit: LexicalUnit;

    if (targetLexicalUnitId) {
      const target = await this.database.lexicalUnits.get(targetLexicalUnitId);
      if (!target) throw new Error("Target lexical unit no longer exists.");
      if (normalizeLanguage(target.language) !== language) {
        throw new Error("Target lexical unit uses a different language.");
      }

      lexicalUnit = { ...target, updatedAt: now };
      await this.database.lexicalUnits.put(lexicalUnit);
    } else {
      const direct = await this.database.lexicalUnits
        .where("contentKey")
        .equals(directContentKey)
        .first();
      const observedOwner = direct
        ? undefined
        : await this.findUniqueUnitByObservedSurface(normalizedSurfaceText, language);
      const existing = direct ?? observedOwner;

      if (existing) {
        lexicalUnit = { ...existing, updatedAt: now };
        await this.database.lexicalUnits.put(lexicalUnit);
      } else {
        lexicalUnit = {
          id: crypto.randomUUID(),
          contentKey: directContentKey,
          canonicalText: surfaceText,
          normalizedCanonicalText: normalizedSurfaceText,
          language,
          note: "",
          status: "inbox",
          createdAt: now,
          updatedAt: now,
        };
        await this.database.lexicalUnits.add(lexicalUnit);
      }
    }

    await this.database.occurrences.add({
      id: crypto.randomUUID(),
      lexicalUnitId: lexicalUnit.id,
      surfaceText,
      normalizedSurfaceText,
      context: normalizeText(draft.context).slice(0, 800),
      source: draft.source,
      capturedAt: now,
    });

    return lexicalUnit;
  }

  async listObservedForms(id: string): Promise<ObservedFormGroup[]> {
    const lexicalUnit = await this.database.lexicalUnits.get(id);
    if (!lexicalUnit) throw new Error("Collected item no longer exists.");

    const occurrences = await this.database.occurrences
      .where("lexicalUnitId")
      .equals(id)
      .sortBy("capturedAt");

    const groups = new Map<string, ObservedFormGroup>();
    for (const occurrence of occurrences) {
      const current = groups.get(occurrence.normalizedSurfaceText);
      if (current) {
        current.count += 1;
        current.occurrences.push(occurrence);
        if (!current.surfaceForms.includes(occurrence.surfaceText)) {
          current.surfaceForms.push(occurrence.surfaceText);
        }
      } else {
        groups.set(occurrence.normalizedSurfaceText, {
          normalizedSurfaceText: occurrence.normalizedSurfaceText,
          surfaceForms: [occurrence.surfaceText],
          count: 1,
          occurrences: [occurrence],
        });
      }
    }

    return [...groups.values()].sort(
      (left, right) =>
        right.count - left.count
        || left.normalizedSurfaceText.localeCompare(right.normalizedSurfaceText),
    );
  }

  async previewCanonicalization(
    id: string,
    requestedCanonicalText: string,
    requestedLanguage: string,
  ): Promise<CanonicalizationPreview> {
    const canonicalText = normalizeText(requestedCanonicalText);
    if (!canonicalText) throw new Error("Canonical form cannot be empty.");

    const language = normalizeLanguage(requestedLanguage);
    const contentKey = makeContentKey(canonicalText, language);
    const current = await this.database.lexicalUnits.get(id);
    if (!current) throw new Error("Collected item no longer exists.");

    const currentOccurrenceCount = await this.database.occurrences
      .where("lexicalUnitId")
      .equals(current.id)
      .count();

    if (
      current.contentKey === contentKey
      && current.canonicalText === canonicalText
      && normalizeLanguage(current.language) === language
    ) {
      return {
        kind: "unchanged",
        currentId: current.id,
        currentCanonicalText: current.canonicalText,
        requestedCanonicalText: canonicalText,
        requestedLanguage: language,
        currentOccurrenceCount,
        willReturnToInbox: false,
        survivingLexicalUnitId: current.id,
        resultingOccurrenceCount: currentOccurrenceCount,
      };
    }

    const collision = current.contentKey === contentKey
      ? undefined
      : await this.database.lexicalUnits
      .where("contentKey")
      .equals(contentKey)
      .first();

    if (!collision || collision.id === current.id) {
      return {
        kind: "rename",
        currentId: current.id,
        currentCanonicalText: current.canonicalText,
        requestedCanonicalText: canonicalText,
        requestedLanguage: language,
        currentOccurrenceCount,
        willReturnToInbox: current.status === "ready",
        survivingLexicalUnitId: current.id,
        resultingOccurrenceCount: currentOccurrenceCount,
      };
    }

    const [currentBinding, collisionBinding, collisionOccurrenceCount] = await Promise.all([
      this.database.exportBindings.get(current.id),
      this.database.exportBindings.get(collision.id),
      this.database.occurrences.where("lexicalUnitId").equals(collision.id).count(),
    ]);
    const target: CanonicalizationTargetSummary = {
      id: collision.id,
      canonicalText: collision.canonicalText,
      language: collision.language,
      status: collision.status,
      occurrenceCount: collisionOccurrenceCount,
    };
    const conflictReason = consolidationConflictReason(
      current,
      collision,
      currentBinding,
      collisionBinding,
    );

    if (conflictReason) {
      return {
        kind: "conflict",
        currentId: current.id,
        currentCanonicalText: current.canonicalText,
        requestedCanonicalText: canonicalText,
        requestedLanguage: language,
        currentOccurrenceCount,
        willReturnToInbox: false,
        target,
        resultingOccurrenceCount: currentOccurrenceCount + collisionOccurrenceCount,
        conflictReason,
      };
    }

    const currentHasIdentity =
      currentBinding?.ankiNoteId !== undefined || current.ankiNoteId !== undefined;
    const collisionHasIdentity =
      collisionBinding?.ankiNoteId !== undefined || collision.ankiNoteId !== undefined;
    const keepCurrent = currentHasIdentity && !collisionHasIdentity;
    const survivingLexicalUnitId = keepCurrent ? current.id : collision.id;
    const binding = preferredBinding(
      keepCurrent ? currentBinding : collisionBinding,
      keepCurrent ? collisionBinding : currentBinding,
      survivingLexicalUnitId,
    );
    const preservedAnkiNoteId = binding?.ankiNoteId
      ?? (keepCurrent ? current.ankiNoteId : collision.ankiNoteId);

    return {
      kind: "consolidate",
      currentId: current.id,
      currentCanonicalText: current.canonicalText,
      requestedCanonicalText: canonicalText,
      requestedLanguage: language,
      currentOccurrenceCount,
      willReturnToInbox: true,
      target,
      survivingLexicalUnitId,
      resultingOccurrenceCount: currentOccurrenceCount + collisionOccurrenceCount,
      preservedAnkiNoteId,
    };
  }

  private async collectedItem(id: string): Promise<CollectedItem> {
    const lexicalUnit = await this.database.lexicalUnits.get(id);
    if (!lexicalUnit) throw new Error("Collected item no longer exists.");

    const occurrences = await this.database.occurrences
      .where("lexicalUnitId")
      .equals(id)
      .sortBy("capturedAt");

    return { lexicalUnit, occurrences };
  }

  async capture(draft: CaptureDraft): Promise<CollectedItem> {
    let lexicalUnit!: LexicalUnit;

    await this.database.transaction(
      "rw",
      this.database.lexicalUnits,
      this.database.occurrences,
      async () => {
        lexicalUnit = await this.captureWithinTransaction(draft);
      },
    );

    return this.collectedItem(lexicalUnit.id);
  }

  private async captureBatchEntryWithinTransaction(
    entry: CaptureBatchEntry,
  ): Promise<CaptureBatchOutcome> {
    const surfaceText = normalizeText(entry.draft.text);
    if (!surfaceText) throw new Error("Nothing selected.");

    const normalizedSurfaceText = normalizeIdentityText(surfaceText);
    const language = normalizeLanguage(entry.draft.language);
    const context = normalizeText(entry.draft.context).slice(0, 800);
    const directContentKey = makeContentKey(surfaceText, language);
    const source = entry.draft.source;

    const surfaceOccurrences = await this.database.occurrences
      .where("normalizedSurfaceText")
      .equals(normalizedSurfaceText)
      .toArray();
    const observedOwnerIds = [...new Set(
      surfaceOccurrences.map((occurrence) => occurrence.lexicalUnitId),
    )];
    const observedUnits = (await this.database.lexicalUnits.bulkGet(observedOwnerIds))
      .filter((unit): unit is LexicalUnit => unit !== undefined)
      .filter((unit) => normalizeLanguage(unit.language) === language);
    const matchingOwners = new Map(observedUnits.map((unit) => [unit.id, unit]));

    const directOwner = await this.database.lexicalUnits
      .where("contentKey")
      .equals(directContentKey)
      .first();
    if (directOwner) matchingOwners.set(directOwner.id, directOwner);

    const exactOwnerIds = new Set<string>();
    for (const occurrence of surfaceOccurrences) {
      const owner = matchingOwners.get(occurrence.lexicalUnitId);
      if (!owner) continue;
      if (normalizeText(occurrence.context) !== context) continue;
      if (
        occurrence.source.kind !== source.kind
        || occurrence.source.adapter !== source.adapter
        || occurrence.source.url !== source.url
        || occurrence.source.title !== source.title
      ) {
        continue;
      }
      exactOwnerIds.add(owner.id);
    }

    const resolutionLexicalUnitId = entry.resolutionLexicalUnitId?.trim() || undefined;
    if (resolutionLexicalUnitId && !matchingOwners.has(resolutionLexicalUnitId)) {
      throw new Error(
        "Resolved lexical unit is no longer a current matching owner.",
      );
    }

    if (exactOwnerIds.size === 1) {
      const lexicalUnitId = [...exactOwnerIds][0]!;
      return {
        kind: "unchanged",
        item: await this.collectedItem(lexicalUnitId),
      };
    }

    let targetLexicalUnitId: string | undefined;
    if (exactOwnerIds.size > 1 || matchingOwners.size > 1) {
      if (!resolutionLexicalUnitId) {
        throw new Error(
          "Batch candidate needs an explicit matching lexical-unit resolution.",
        );
      }
      targetLexicalUnitId = resolutionLexicalUnitId;
      if (exactOwnerIds.has(targetLexicalUnitId)) {
        return {
          kind: "unchanged",
          item: await this.collectedItem(targetLexicalUnitId),
        };
      }
    } else if (matchingOwners.size === 1) {
      targetLexicalUnitId = [...matchingOwners.keys()][0]!;
    }

    let lexicalUnit = await this.captureWithinTransaction(
      entry.draft,
      targetLexicalUnitId,
    );
    const kind: CaptureBatchOutcomeKind = targetLexicalUnitId
      ? "evidence-added"
      : "new-unit";

    if (lexicalUnit.status !== "inbox") {
      lexicalUnit = {
        ...lexicalUnit,
        status: "inbox",
        updatedAt: entry.draft.capturedAt || new Date().toISOString(),
      };
      await this.database.lexicalUnits.put(lexicalUnit);
    }

    return {
      kind,
      item: await this.collectedItem(lexicalUnit.id),
    };
  }

  async captureBatch(entries: readonly CaptureBatchEntry[]): Promise<CaptureBatchOutcome[]> {
    if (entries.length === 0) return [];

    const outcomes: CaptureBatchOutcome[] = [];

    await this.database.transaction(
      "rw",
      this.database.lexicalUnits,
      this.database.occurrences,
      async () => {
        for (const entry of entries) {
          outcomes.push(await this.captureBatchEntryWithinTransaction(entry));
        }
      },
    );

    return outcomes;
  }

  async list(status?: ReviewStatus): Promise<CollectedItem[]> {
    const units = status
      ? await this.database.lexicalUnits.where("status").equals(status).toArray()
      : await this.database.lexicalUnits.toArray();
    const occurrences = await this.database.occurrences.toArray();
    const grouped = new Map<string, Occurrence[]>();

    for (const occurrence of occurrences) {
      const values = grouped.get(occurrence.lexicalUnitId) ?? [];
      values.push(occurrence);
      grouped.set(occurrence.lexicalUnitId, values);
    }

    return units
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((lexicalUnit) => ({
        lexicalUnit,
        occurrences: (grouped.get(lexicalUnit.id) ?? [])
          .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)),
      }));
  }

  async update(id: string, changes: EditLexicalUnitInput): Promise<CollectedItem> {
    const canonicalText = normalizeText(changes.canonicalText);
    if (!canonicalText) throw new Error("Canonical form cannot be empty.");

    const language = normalizeLanguage(changes.language);
    const normalizedCanonicalText = normalizeIdentityText(canonicalText);
    const contentKey = makeContentKey(canonicalText, language);
    const requestedNote = changes.note.trim().slice(0, 2000);
    const requestedSurface = changes.surfaceText === undefined
      ? undefined
      : normalizeText(changes.surfaceText);
    if (changes.surfaceText !== undefined && !requestedSurface) {
      throw new Error("Observed form cannot be empty.");
    }

    const now = new Date().toISOString();
    let lexicalUnit!: LexicalUnit;
    let resultId = id;

    await this.database.transaction(
      "rw",
      this.database.lexicalUnits,
      this.database.occurrences,
      this.database.exportBindings,
      async () => {
        const current = await this.database.lexicalUnits.get(id);
        if (!current) throw new Error("Collected item no longer exists.");

        const collision = await this.database.lexicalUnits
          .where("contentKey")
          .equals(contentKey)
          .first();

        if (collision && collision.id !== id) {
          const [currentBinding, collisionBinding] = await Promise.all([
            this.database.exportBindings.get(current.id),
            this.database.exportBindings.get(collision.id),
          ]);

          const conflictReason = consolidationConflictReason(
            current,
            collision,
            currentBinding,
            collisionBinding,
          );
          if (conflictReason) throw new Error(conflictReason);

          const currentHasIdentity =
            currentBinding?.ankiNoteId !== undefined || current.ankiNoteId !== undefined;
          const collisionHasIdentity =
            collisionBinding?.ankiNoteId !== undefined || collision.ankiNoteId !== undefined;

          const keepCurrent = currentHasIdentity && !collisionHasIdentity;
          const mergedNote = combineNotes(requestedNote, collision.note);
          const createdAt = current.createdAt < collision.createdAt
            ? current.createdAt
            : collision.createdAt;

          if (keepCurrent) {
            await this.database.occurrences
              .where("lexicalUnitId")
              .equals(collision.id)
              .modify({ lexicalUnitId: current.id });
            await this.database.lexicalUnits.delete(collision.id);
            const binding = preferredBinding(currentBinding, collisionBinding, current.id);
            await this.database.exportBindings.delete(collision.id);
            if (binding) await this.database.exportBindings.put(binding);

            lexicalUnit = {
              ...current,
              contentKey,
              canonicalText,
              normalizedCanonicalText,
              language,
              note: mergedNote,
              status: "inbox",
              createdAt,
              updatedAt: now,
            };
            await this.database.lexicalUnits.put(lexicalUnit);
            resultId = current.id;
          } else {
            await this.database.occurrences
              .where("lexicalUnitId")
              .equals(current.id)
              .modify({ lexicalUnitId: collision.id });
            await this.database.lexicalUnits.delete(current.id);
            const binding = preferredBinding(collisionBinding, currentBinding, collision.id);
            await this.database.exportBindings.delete(current.id);
            if (binding) await this.database.exportBindings.put(binding);

            lexicalUnit = {
              ...collision,
              contentKey,
              canonicalText,
              normalizedCanonicalText,
              language,
              note: mergedNote,
              status: "inbox",
              createdAt,
              updatedAt: now,
            };
            await this.database.lexicalUnits.put(lexicalUnit);
            resultId = collision.id;
          }
        } else {
          lexicalUnit = {
            ...current,
            contentKey,
            canonicalText,
            normalizedCanonicalText,
            language,
            note: requestedNote,
            status: current.status === "ready" ? "inbox" : current.status,
            updatedAt: now,
          };
          await this.database.lexicalUnits.put(lexicalUnit);
        }

        if (
          changes.occurrenceId !== undefined &&
          (changes.context !== undefined || requestedSurface !== undefined)
        ) {
          const occurrence = await this.database.occurrences.get(changes.occurrenceId);
          if (!occurrence || occurrence.lexicalUnitId !== resultId) {
            throw new Error("The selected occurrence no longer belongs to this item.");
          }

          await this.database.occurrences.update(occurrence.id, {
            ...(changes.context === undefined
              ? {}
              : { context: normalizeText(changes.context).slice(0, 800) }),
            ...(requestedSurface === undefined
              ? {}
              : {
                  surfaceText: requestedSurface,
                  normalizedSurfaceText: normalizeIdentityText(requestedSurface),
                }),
          });
        }
      },
    );

    const occurrences = await this.database.occurrences
      .where("lexicalUnitId")
      .equals(resultId)
      .sortBy("capturedAt");

    return { lexicalUnit, occurrences };
  }

  async previewRestore(backup: BackupDocument): Promise<RestorePreview> {
    const [localUnits, localOccurrences, localBindings] = await Promise.all([
      this.database.lexicalUnits.toArray(),
      this.database.occurrences.toArray(),
      this.database.exportBindings.toArray(),
    ]);
    return buildRestorePlan(backup, localUnits, localOccurrences, localBindings).preview;
  }

  async restoreBackup(backup: BackupDocument): Promise<RestorePreview> {
    let completedPreview!: RestorePreview;

    await this.database.transaction(
      "rw",
      this.database.lexicalUnits,
      this.database.occurrences,
      this.database.exportBindings,
      async () => {
        const [localUnits, localOccurrences, localBindings] = await Promise.all([
          this.database.lexicalUnits.toArray(),
          this.database.occurrences.toArray(),
          this.database.exportBindings.toArray(),
        ]);
        const plan = buildRestorePlan(backup, localUnits, localOccurrences, localBindings);

        if (plan.preview.conflicts.length > 0) {
          throw new Error(`Backup has ${plan.preview.conflicts.length} conflict(s). Resolve them before restoring.`);
        }

        for (const unit of plan.lexicalUnitsToAdd) {
          await this.database.lexicalUnits.add(unit);
        }
        for (const unit of plan.lexicalUnitsToUpdate) {
          await this.database.lexicalUnits.put(unit);
        }
        for (const occurrence of plan.occurrencesToAdd) {
          await this.database.occurrences.add(occurrence);
        }
        for (const occurrence of plan.occurrencesToUpdate) {
          await this.database.occurrences.put(occurrence);
        }
        for (const binding of plan.exportBindingsToAdd) {
          await this.database.exportBindings.add(binding);
        }

        completedPreview = plan.preview;
      },
    );

    return completedPreview;
  }

  async listExportBindings(): Promise<ExportBinding[]> {
    return this.database.exportBindings.toArray();
  }

  async getExportBinding(lexicalUnitId: string): Promise<ExportBinding | null> {
    return await this.database.exportBindings.get(lexicalUnitId) ?? null;
  }

  async setExportBinding(binding: Omit<ExportBinding, "updatedAt"> & { updatedAt?: string }): Promise<void> {
    await this.database.transaction(
      "rw",
      this.database.lexicalUnits,
      this.database.exportBindings,
      async () => {
        const lexicalUnit = await this.database.lexicalUnits.get(binding.lexicalUnitId);
        if (!lexicalUnit) throw new Error("Collected item no longer exists.");

        const current = await this.database.exportBindings.get(binding.lexicalUnitId);
        if (current?.state === "reserved") {
          const sameDestination =
            current.profileId === binding.profileId
            && current.deckName === binding.deckName
            && current.deckId === binding.deckId
            && current.modelName === binding.modelName
            && current.modelId === binding.modelId;
          const validReconciliation =
            sameDestination
            && (
              binding.state === "reserved"
              || (binding.state === "exported" && binding.ankiNoteId !== undefined)
            );

          if (!validReconciliation) {
            throw new Error(
              "Cannot change a reserved Anki identity before reconciliation completes.",
            );
          }
        }

        await this.database.exportBindings.put({
          ...binding,
          updatedAt: binding.updatedAt ?? new Date().toISOString(),
        });
      },
    );
  }

  async clearExportBinding(lexicalUnitId: string): Promise<void> {
    await this.database.transaction(
      "rw",
      this.database.exportBindings,
      async () => {
        const current = await this.database.exportBindings.get(lexicalUnitId);
        if (current?.state === "reserved") {
          throw new Error(
            "Cannot clear a reserved Anki identity before reconciliation completes.",
          );
        }
        await this.database.exportBindings.delete(lexicalUnitId);
      },
    );
  }

  async setStatus(id: string, status: ReviewStatus): Promise<void> {
    await this.database.lexicalUnits.update(id, {
      status,
      updatedAt: new Date().toISOString(),
    });
  }

  async setAnkiNoteId(id: string, ankiNoteId: number): Promise<void> {
    await this.database.lexicalUnits.update(id, {
      ankiNoteId,
      updatedAt: new Date().toISOString(),
    });
  }

  async remove(id: string): Promise<void> {
    await this.database.transaction(
      "rw",
      this.database.lexicalUnits,
      this.database.occurrences,
      this.database.exportBindings,
      async () => {
        const binding = await this.database.exportBindings.get(id);
        if (binding?.state === "reserved") {
          throw new Error(
            "Cannot delete this item while an Anki export is awaiting reconciliation.",
          );
        }

        await this.database.occurrences.where("lexicalUnitId").equals(id).delete();
        await this.database.exportBindings.delete(id);
        await this.database.lexicalUnits.delete(id);
      },
    );
  }
}

export const repository = new CaptureRepository();
