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

// Probe an origin for a Parachute Vault. Two paths:
//
//   1. Ecosystem discovery: fetch `${origin}/.well-known/parachute.json` and
//      pick a vault entry (name=default, else first). Validate by hitting its
//      OAuth metadata.
//   2. Direct: probe `${input}/.well-known/oauth-authorization-server` — for
//      when the user pasted a vault URL directly (e.g. `https://h/vault/work`)
//      without a parachute.json registry on the origin.
//
// Returns the discovered vault URL (full path including `/vault/<name>`) or
// null if neither path resolves.
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

  return tryDiscoverAuthServer(origin, timeoutMs, fetchImpl);
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
