import { useEffect, useState } from "react";
import { discoverAuthServer } from "./discovery";
import { fetchParachuteJson, pickVault } from "./parachute-json";
import { useVaultStore } from "./store";

export type ProbeStatus = "probing" | "found" | "not-found" | "skipped";

export interface ProbeResult {
  status: ProbeStatus;
  // Full vault URL (origin + `/vault/<name>`), not just origin. Naming kept
  // for backwards-compat with existing callers.
  origin: string | null;
}

const DEFAULT_TIMEOUT_MS = 2500;

// Probe an input URL for a Parachute OAuth issuer. Two paths, in this order:
//
//   1. Ecosystem registry: `${origin}/.well-known/parachute.json` → pick a
//      vault entry (name=default, else first) → validate by hitting its
//      OAuth metadata. This is the path that matters for the hub-as-portal
//      case: the hub origin *itself* proxies OAuth metadata (so direct
//      discovery would succeed at the hub origin, which isn't a vault),
//      but only the registry reveals the actual vault resource URL
//      (`${origin}/vault/<name>`). Preferring the registry ensures Lens
//      ends up pointing at the vault and not at the portal.
//   2. Direct OAuth discovery fallback:
//      `${input}/.well-known/oauth-authorization-server`. Covers the
//      standalone vault case (user pastes `http://localhost:1940`) and
//      the vault-behind-a-non-hub-proxy case (user pastes
//      `https://my-vault.example.com/vault/default`) — neither serves
//      parachute.json, but both answer OAuth metadata directly.
//
// Returns the URL that successfully resolves OAuth metadata (either the
// registry-pointed vault URL or the input itself), or null if neither
// path resolves.
export async function probeVaultAtOrigin(
  origin: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<string | null> {
  const manifest = await fetchParachuteJson(origin, timeoutMs, fetchImpl);
  if (manifest) {
    const chosen = pickVault(manifest);
    if (chosen) {
      const validated = await tryDiscoverAuthServer(chosen.url, timeoutMs, fetchImpl);
      if (validated) return validated;
    }
  }

  const direct = await tryDiscoverAuthServer(origin, timeoutMs, fetchImpl);
  if (direct) return direct;

  return null;
}

async function tryDiscoverAuthServer(
  candidate: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const withSignal: typeof fetch = (input, init) =>
    fetchImpl(input, { ...(init ?? {}), signal: ctrl.signal });
  try {
    await discoverAuthServer(candidate, withSignal);
    return candidate;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Probe the current window's origin on mount, but skip if the user already has
// vaults in storage — their choice is already made and a probe would just be
// noise + a wasted request.
export function useOriginVaultProbe(): ProbeResult {
  const hasVaults = useVaultStore((s) => Object.keys(s.vaults).length > 0);
  const [result, setResult] = useState<ProbeResult>(() => ({
    status: hasVaults ? "skipped" : "probing",
    origin: null,
  }));

  useEffect(() => {
    if (hasVaults) {
      setResult({ status: "skipped", origin: null });
      return;
    }
    let cancelled = false;
    setResult({ status: "probing", origin: null });
    probeVaultAtOrigin(window.location.origin).then((found) => {
      if (cancelled) return;
      setResult(found ? { status: "found", origin: found } : { status: "not-found", origin: null });
    });
    return () => {
      cancelled = true;
    };
  }, [hasVaults]);

  return result;
}
