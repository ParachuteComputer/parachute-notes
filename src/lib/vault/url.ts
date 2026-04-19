/**
 * Normalize a user-entered vault URL to the canonical "vault root" form:
 * no trailing slash, no common API/MCP suffixes, lowercased host.
 *
 * Throws if the input is not a valid absolute HTTP(S) URL.
 */
export function normalizeVaultUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Vault URL is required");

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("Not a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Vault URL must use http or https");
  }

  parsed.hash = "";
  parsed.search = "";
  parsed.host = parsed.host.toLowerCase();

  let path = parsed.pathname.replace(/\/+$/, "");
  const stripSuffixes = [
    "/api",
    "/mcp",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
    "/.well-known/parachute.json",
    "/oauth/authorize",
    "/oauth/token",
    "/oauth/register",
  ];
  for (const suffix of stripSuffixes) {
    if (path.toLowerCase().endsWith(suffix)) {
      path = path.slice(0, -suffix.length);
      break;
    }
  }
  parsed.pathname = path || "";

  return parsed.toString().replace(/\/$/, "");
}

export function vaultIdFromUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/[^\w.-]+/g, "_");
}

// Vault PR 7 moved every endpoint under `/vault/<name>/`. Older stored
// VaultRecords whose URL is origin-only (or the previous `/vaults/<name>/`
// plural) won't reach the new endpoints and their tokens are invalid because
// vault's issuer changed. Detect them so the Vaults page can prompt re-add.
export function isLegacyVaultUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  return !(segments.length >= 2 && segments[0] === "vault");
}
