import type { CollectedItem } from "../core/types";

function cleanCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

export function toTsv(items: CollectedItem[]): string {
  const rows = items.map((item) => {
    const latest = item.occurrences.at(-1);
    return [
      item.lexicalUnit.id,
      item.lexicalUnit.displayText,
      latest?.context ?? "",
      latest?.source.url ?? "",
    ].map(cleanCell).join("\t");
  });

  return ["CollectorID\tExpression\tContext\tSource", ...rows].join("\n");
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
