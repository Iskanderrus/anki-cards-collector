import { describe, expect, it } from "vitest";
import { makeContentKey, normalizeIdentityText, normalizeLanguage, normalizeText } from "./normalize";

describe("normalizeText", () => {
  it("collapses whitespace without changing meaningful punctuation", () => {
    expect(normalizeText("  ¿Qué   tal?\n")).toBe("¿Qué tal?");
  });

  it("normalizes unicode compatibility forms", () => {
    expect(normalizeText("ＡＢＣ")).toBe("ABC");
  });
});

describe("normalizeIdentityText", () => {
  it("normalizes case and whitespace for identity comparisons", () => {
    expect(normalizeIdentityText("  Tengo   GANAS de ")).toBe("tengo ganas de");
  });
});

describe("normalizeLanguage", () => {
  it("normalizes stored and incoming language codes to one ownership identity", () => {
    expect(normalizeLanguage(" HE ")).toBe("he");
    expect(normalizeLanguage("")).toBe("und");
  });
});

describe("makeContentKey", () => {
  it("deduplicates case and whitespace for the same language", () => {
    expect(makeContentKey("  Hola   mundo ", "ES"))
      .toBe(makeContentKey("hola mundo", "es"));
  });
});
