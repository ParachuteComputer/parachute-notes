// Discovery primitive served at `${origin}/.well-known/parachute.json` by the
// Parachute CLI when an install is registered for the host. Lets Notes find
// the running vault without hardcoding a path. Schema is tolerant by design —
// the CLI may write either single- or multi-vault shapes.
//
// Accepted shapes:
//   { "vault":  { "url": "https://host/vault/default" } }
//   { "vaults": [{ "name": "default", "url": "..." }, { "name": "work", "url": "..." }] }
//   (and combinations — `vaults` wins if both present)

const WELL_KNOWN_PATH = "/.well-known/parachute.json";
const DEFAULT_TIMEOUT_MS = 2500;

export interface ParachuteJsonVault {
  name: string;
  url: string;
}

export interface ParachuteJson {
  vaults: ParachuteJsonVault[];
}

export async function fetchParachuteJson(
  origin: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<ParachuteJson | null> {
  const url = `${stripTrailingSlash(originOf(origin))}${WELL_KNOWN_PATH}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as unknown;
    return parseParachuteJson(raw);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function parseParachuteJson(raw: unknown): ParachuteJson | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const vaults: ParachuteJsonVault[] = [];

  if (Array.isArray(r.vaults)) {
    for (const entry of r.vaults) {
      const v = coerceVault(entry, vaults.length === 0 ? "default" : `vault-${vaults.length}`);
      if (v) vaults.push(v);
    }
  }

  if (vaults.length === 0 && r.vault && typeof r.vault === "object") {
    const single = coerceVault(r.vault, "default");
    if (single) vaults.push(single);
  }

  if (vaults.length === 0) return null;
  return { vaults };
}

// Pick the best vault from a parachute.json. Prefer one named `default` (or
// matching the caller's preference); fall back to the first entry. Returns
// `null` only when the manifest has no vaults at all.
export function pickVault(
  manifest: ParachuteJson,
  preferredName?: string,
): ParachuteJsonVault | null {
  if (manifest.vaults.length === 0) return null;
  if (preferredName) {
    const match = manifest.vaults.find((v) => v.name === preferredName);
    if (match) return match;
  }
  const def = manifest.vaults.find((v) => v.name === "default");
  if (def) return def;
  return manifest.vaults[0] ?? null;
}

function coerceVault(raw: unknown, fallbackName: string): ParachuteJsonVault | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const url = typeof r.url === "string" ? r.url.trim() : "";
  if (!url) return null;
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : fallbackName;
  return { name, url };
}

function originOf(input: string): string {
  try {
    return new URL(input).origin;
  } catch {
    return input;
  }
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}
