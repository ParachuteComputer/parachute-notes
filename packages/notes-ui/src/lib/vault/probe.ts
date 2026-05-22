import { useEffect, useState } from "react";
import { discoverAuthServer } from "./discovery";
import { useVaultStore } from "./store";

export type ProbeStatus = "probing" | "found" | "not-found" | "skipped";

export interface ProbeResult {
  status: ProbeStatus;
  // The OAuth issuer URL — passed straight into `beginOAuth`. Under
  // hub-as-issuer this is the hub origin; under a standalone vault it's the
  // vault URL. Naming `origin` (not `issuerUrl`) is kept for backwards-compat
  // with existing callers; semantically these are the same thing.
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

// Probe a candidate URL for an OAuth authorization server. Under hub-as-issuer
// the hub origin itself answers `/.well-known/oauth-authorization-server`; the
// JWT it mints carries a `services` catalog so notes never has to chase a
// vault URL separately. For a standalone vault (no hub fronting it), the
// vault URL itself answers OAuth metadata directly. Same probe shape covers
// both cases.
//
// Returns the probed URL on success, or `null` if discovery fails or times out.
export async function probeIssuerAtOrigin(
  origin: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<string | null> {
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

// Try the same-origin probe first, then fall back to the canonical local hub.
// The fallback covers the standalone-notes case (`parachute install notes` →
// `http://localhost:1942/notes`): the static notes server doesn't serve
// OAuth metadata, but the hub on 1939 does. We only attempt the fallback for
// localhost-ish origins that aren't already on the hub port — never for
// remote/tailscale origins, where reaching the user's loopback would be
// nonsensical (and CORS would block it anyway).
//
// CORS note: the fallback is cross-origin (1942 → 1939). The hub must serve
// `Access-Control-Allow-Origin: *` on `/.well-known/oauth-authorization-server`
// for the browser to expose the response body. If it doesn't, the fetch
// rejects and we fall through to manual entry.
export async function probeForIssuer(
  pageOrigin: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<string | null> {
  const sameOrigin = await probeIssuerAtOrigin(pageOrigin, timeoutMs, fetchImpl);
  if (sameOrigin) return sameOrigin;

  if (shouldTryLocalHubFallback(pageOrigin)) {
    const local = await probeIssuerAtOrigin(LOCAL_HUB_URL, timeoutMs, fetchImpl);
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
    probeForIssuer(window.location.origin).then((found) => {
      if (cancelled) return;
      setResult(found ? { status: "found", origin: found } : { status: "not-found", origin: null });
    });
    return () => {
      cancelled = true;
    };
  }, [hasVaults]);

  return result;
}
