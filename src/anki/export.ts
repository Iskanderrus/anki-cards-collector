import type { CollectedItem } from "../core/types";
import { proposeLearningCard } from "../learning/policy";

function cleanCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

export function toTsv(items: CollectedItem[]): string {
  const rows = items.map((item) => {
    const latest = item.occurrences.at(-1);
    const proposal = proposeLearningCard(item);
    return [
      item.lexicalUnit.id,
      proposal.cardKind,
      proposal.prompt,
      proposal.answer,
      proposal.reason,
      item.lexicalUnit.canonicalText,
      latest?.surfaceText ?? item.lexicalUnit.canonicalText,
      latest?.context ?? "",
      item.lexicalUnit.note,
      latest?.source.url ?? "",
    ].map(cleanCell).join("\t");
  });

  return [
    "CollectorID\tCardKind\tPrompt\tAnswer\tWhy\tCanonical\tObserved\tContext\tNote\tSource",
    ...rows,
  ].join("\n");
}

export function downloadText(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
