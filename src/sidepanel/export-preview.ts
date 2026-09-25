import type {
  CollectedItem,
  CollectorSettings,
  ExportBinding,
  ExportProfile,
} from "../core/types";
import { proposeLearningCard } from "../learning/policy";
import {
  resolveExportRoute,
  validateProfileForCurrentExport,
} from "../anki/routing";

export interface ExportPreviewGroup {
  key: string;
  profileId: string;
  profileName: string;
  deckName: string;
  modelName: string;
  count: number;
}

export interface ExportPreviewBlockedItem {
  id: string;
  canonicalText: string;
  reason: string;
}

export interface ExportPreview {
  totalReady: number;
  exportable: number;
  blocked: number;
  exportableIds: string[];
  groups: ExportPreviewGroup[];
  blockedItems: ExportPreviewBlockedItem[];
}

export interface ExportPreviewValidationClient {
  validateProfileLive(profile: ExportProfile): Promise<void>;
}

function destinationKey(profile: ExportProfile): string {
  return JSON.stringify([
    profile.id,
    profile.deckName,
    profile.deckId ?? "",
    profile.modelName,
    profile.modelId ?? "",
    profile.mode,
  ]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "This item cannot be exported yet.";
}

function blockedReason(item: CollectedItem, error: unknown): string {
  const message = errorMessage(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("missing profile")
    || lower.includes("no valid fallback")
    || lower.includes("language route")
  ) {
    const language = item.lexicalUnit.language || "this language";
    return "No usable Anki profile is configured for " + language + ". Set one up in Settings → Anki profiles.";
  }

  if (
    lower.includes("failed to fetch")
    || lower.includes("network")
    || lower.includes("ankiconnect")
    || lower.includes("connect")
  ) {
    return "Anki isn't available. Open Anki Desktop, make sure AnkiConnect is running, then reopen Export.";
  }

  if (
    lower.includes("mapping")
    || lower.includes("mapped")
    || lower.includes("field")
    || lower.includes("note type")
    || lower.includes("note-type")
    || lower.includes("model")
    || lower.includes("template")
    || lower.includes("cloze")
  ) {
    return "This Anki profile needs attention. Open Settings → Anki profiles and revalidate its note type and field mapping.";
  }

  if (lower.includes("identity") || lower.includes("refresh and re-confirm")) {
    return "This Anki profile changed in live Anki. Open Settings → Anki profiles and revalidate it before exporting.";
  }

  return "Review this item's Anki destination before exporting.";
}

export async function buildExportPreview(
  items: CollectedItem[],
  settings: CollectorSettings,
  bindings: Record<string, ExportBinding>,
  client: ExportPreviewValidationClient,
): Promise<ExportPreview> {
  const ready = items.filter((item) => item.lexicalUnit.status === "ready");
  const exportableIds: string[] = [];
  const blockedItems: ExportPreviewBlockedItem[] = [];
  const grouped = new Map<string, ExportPreviewGroup>();
  const liveValidations = new Map<string, Promise<void>>();

  for (const item of ready) {
    const proposal = proposeLearningCard(item);
    if (!proposal.recommended) {
      blockedItems.push({
        id: item.lexicalUnit.id,
        canonicalText: item.lexicalUnit.canonicalText,
        reason: proposal.warning ?? "Review this study item before exporting it.",
      });
      continue;
    }

    try {
      const route = resolveExportRoute(
        item,
        settings,
        bindings[item.lexicalUnit.id] ?? null,
      );
      validateProfileForCurrentExport(route.profile);
      const key = destinationKey(route.profile);

      let validation = liveValidations.get(key);
      if (!validation) {
        validation = client.validateProfileLive(route.profile);
        liveValidations.set(key, validation);
      }
      await validation;

      exportableIds.push(item.lexicalUnit.id);
      const current = grouped.get(key);
      if (current) {
        current.count += 1;
      } else {
        grouped.set(key, {
          key,
          profileId: route.profile.id,
          profileName: route.profile.name,
          deckName: route.profile.deckName,
          modelName: route.profile.modelName,
          count: 1,
        });
      }
    } catch (error) {
      blockedItems.push({
        id: item.lexicalUnit.id,
        canonicalText: item.lexicalUnit.canonicalText,
        reason: blockedReason(item, error),
      });
    }
  }

  return {
    totalReady: ready.length,
    exportable: exportableIds.length,
    blocked: blockedItems.length,
    exportableIds,
    groups: [...grouped.values()].sort((left, right) =>
      left.profileName.localeCompare(right.profileName)
      || left.deckName.localeCompare(right.deckName)
    ),
    blockedItems,
  };
}

export function friendlyExportFailure(error: string): string {
  const lower = error.toLowerCase();

  if (
    lower.includes("failed to fetch")
    || lower.includes("network")
    || lower.includes("anki unavailable")
    || lower.includes("ankiconnect")
    || lower.includes("connect")
  ) {
    return "Anki isn't available. Open Anki Desktop, make sure AnkiConnect is running, then Retry.";
  }

  if (
    lower.includes("mapping")
    || lower.includes("field")
    || lower.includes("note type")
    || lower.includes("model")
  ) {
    return "This Anki profile no longer matches its note type. Open Settings → Anki profiles, revalidate it, then Retry.";
  }

  if (lower.includes("deck") || lower.includes("destination")) {
    return "The destination deck needs attention. Review this item's Anki destination before exporting.";
  }

  return "This item was not exported. Review its Anki profile and destination, then Retry.";
}
