import type { SourceUrlMode } from "../core/types";

const TRACKING_PARAMETERS = new Set([
  "dclid",
  "fbclid",
  "gclid",
  "gbraid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "srsltid",
  "vero_conv",
  "vero_id",
  "wbraid",
  "_hsenc",
  "_hsmi",
]);

function isTrackingParameter(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.startsWith("utm_") || TRACKING_PARAMETERS.has(normalized);
}

export function sanitizeSourceUrl(rawUrl: string, mode: SourceUrlMode): string {
  if (mode === "none") return "";

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "";
  }

  url.username = "";
  url.password = "";
  url.hash = "";

  for (const key of [...url.searchParams.keys()]) {
    if (isTrackingParameter(key)) {
      url.searchParams.delete(key);
    }
  }

  if (mode === "sanitized") {
    url.search = "";
  }

  return url.toString();
}
