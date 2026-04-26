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

// Canonical Parachute hub address on a local install. The hub binds itself
// to 127.0.0.1:1939 (see parachute-hub/src/service-spec.ts). Hardcoded here
// because the browser has no other way to discover it — `~/.parachute/hub.port`
// is on disk, not visible to JS. Used as a fallback when the same-origin
// probe fails (e.g. Notes is served standalone at :1942 instead of behind
// the hub portal at :1939/notes).
const LOCAL_HUB_URL = "http://127.0.0.1:1939";

// Probe an input URL for a Parachute OAuth issuer. Two paths, in this order:
//
//   1. Ecosystem registry: `${origin}/.well-known/parachute.json` → pick a
//      vault entry (name=default, else first) → validate by hitting its
//      OAuth metadata. This is the path that matters for the hub-as-portal
//      case: the hub origin *itself* proxies OAuth metadata (so direct
//      discovery would succeed at the hub origin, which isn't a vault),
//      but only the registry reveals the actual vault resource URL
//      (`${origin}/vault/<name>`). Preferring the registry ensures Notes
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

// Try the same-origin probe first, then fall back to the canonical local hub.
// The fallback covers the standalone-notes case (`parachute install notes` →
// `http://localhost:1942/notes`): the static notes server doesn't serve
// `parachute.json`, but the hub on 1939 does. We only attempt the fallback
// for localhost-ish origins that aren't already on the hub port — never for
// remote/tailscale origins, where reaching the user's loopback would be
// nonsensical (and CORS would block it anyway).
//
// CORS note: the fallback is cross-origin (1942 → 1939). The hub must serve
// `Access-Control-Allow-Origin: *` on `/.well-known/parachute.json` for the
// browser to expose the response body. If it doesn't, the fetch rejects and
// we fall through to manual entry — same as if the hub weren't running.
export async function probeForVault(
  pageOrigin: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<string | null> {
  const sameOrigin = await probeVaultAtOrigin(pageOrigin, timeoutMs, fetchImpl);
  if (sameOrigin) return sameOrigin;

  if (shouldTryLocalHubFallback(pageOrigin)) {
    const local = await probeVaultAtOrigin(LOCAL_HUB_URL, timeoutMs, fetchImpl);
    if (local) return local;
  }

  return null;
}

export function shouldTryLocalHubFallback(pageOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(pageOrigin);
  } catch {
    return false;
  }
  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (!isLoopback) return false;
  // Already on the hub origin — same-origin probe already covered it.
  if (url.origin === LOCAL_HUB_URL) return false;
  return true;
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
    probeForVault(window.location.origin).then((found) => {
      if (cancelled) return;
      setResult(found ? { status: "found", origin: found } : { status: "not-found", origin: null });
    });
    return () => {
      cancelled = true;
    };
  }, [hasVaults]);

  return result;
}
