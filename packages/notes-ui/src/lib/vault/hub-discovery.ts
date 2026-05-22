import type { VaultRecord } from "./types";

/**
 * Vault entries the hub publishes at `/.well-known/parachute.json`. Mirrors
 * the `WellKnownVaultEntry` shape in `parachute-hub/src/well-known.ts`
 * (intentionally re-declared here so Notes doesn't pick up a transitive hub
 * dependency).
 */
export interface HubVaultEntry {
  name: string;
  url: string;
  version: string;
  managementUrl?: string;
}

/**
 * Derive the OAuth/discovery origin Notes should query for a stored vault.
 * Under hub-as-issuer (the standard install) `VaultRecord.issuer` is the
 * hub origin itself — captured at OAuth time in OAuthCallback.tsx. Under a
 * standalone vault `issuer` equals the vault URL; the well-known fetch will
 * fail or return no peer vaults, which is the right answer in that case.
 *
 * Returning the origin (not the full issuer URL) lets a hub fronted at a
 * sub-path still answer `<origin>/.well-known/parachute.json` cleanly —
 * matches the path the hub's own admin SPA uses.
 */
export function hubOriginForVault(vault: Pick<VaultRecord, "issuer">): string | null {
  try {
    return new URL(vault.issuer).origin;
  } catch {
    return null;
  }
}

function isHubVaultEntry(value: unknown): value is HubVaultEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === "string" && typeof v.url === "string" && typeof v.version === "string";
}

/**
 * Fetch the hub's vault list. Same-origin in standard installs, CORS-open
 * cross-origin. Returns the vault array on success, `null` on any failure
 * (network, non-2xx, malformed JSON) — callers treat "no list" as
 * "popover doesn't render the Available section".
 *
 * `hubOrigin` is the bare origin (`https://hub.example`); the well-known
 * path is appended here so callers don't have to know the URL shape.
 */
export async function fetchHubVaults(
  hubOrigin: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
  signal?: AbortSignal,
): Promise<HubVaultEntry[] | null> {
  const url = `${hubOrigin.replace(/\/$/, "")}/.well-known/parachute.json`;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Accept: "application/json" }, signal });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const vaults = (parsed as Record<string, unknown>).vaults;
  if (!Array.isArray(vaults)) return null;

  return vaults.filter(isHubVaultEntry);
}
