import { describe, expect, it } from "vitest";
import { sanitizeSourceUrl } from "./source-url";

describe("sanitizeSourceUrl", () => {
  it("keeps only origin and path in the default sanitized mode", () => {
    expect(sanitizeSourceUrl(
      "https://user:secret@example.com/article?id=42&utm_source=test#section",
      "sanitized",
    )).toBe("https://example.com/article");
  });

  it("keeps useful query parameters but removes tracking data in query mode", () => {
    expect(sanitizeSourceUrl(
      "https://example.com/search?q=serbian&utm_medium=email&gclid=abc#results",
      "query",
    )).toBe("https://example.com/search?q=serbian");
  });

  it("never keeps credentials or fragments", () => {
    expect(sanitizeSourceUrl(
      "https://alex:secret@example.com/path?chapter=3#private",
      "query",
    )).toBe("https://example.com/path?chapter=3");
  });

  it("can omit the source URL entirely", () => {
    expect(sanitizeSourceUrl("https://example.com/private?id=7", "none")).toBe("");
  });

  it("drops malformed URLs instead of persisting untrusted text", () => {
    expect(sanitizeSourceUrl("not a url", "query")).toBe("");
  });
});
