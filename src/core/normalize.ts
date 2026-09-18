export function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function normalizeIdentityText(value: string): string {
  return normalizeText(value).toLocaleLowerCase();
}

export function makeContentKey(text: string, language: string): string {
  return `${language.trim().toLowerCase() || "und"}::${normalizeIdentityText(text)}`;
}
