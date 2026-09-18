export function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function makeContentKey(text: string, language: string): string {
  return `${language.trim().toLowerCase() || "und"}::${normalizeText(text).toLocaleLowerCase()}`;
}
