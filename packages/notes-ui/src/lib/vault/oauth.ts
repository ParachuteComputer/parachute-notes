/**
 * Notes' OAuth flow — orchestrates `@openparachute/app-client`'s PKCE +
 * discovery + DCR primitives around Notes-specific concerns:
 *
 *   - `priorHaltedVaultId` round-trip via sessionStorage (notes#148) so
 *     OAuthCallback can clear the originally-halted vault's halt entry
 *     on success even when the new vault URL resolves to a different
 *     `vaultIdFromUrl`.
 *   - Issuer-keyed DCR cache (one client_id per issuer per browser),
 *     distinct from app-client's per-app in-memory cache because Notes
 *     was registered before app-client existed and we want to reuse
 *     historical localStorage entries rather than re-DCR on first load.
 *   - `redirectUriForOrigin` derived from `detectMountBase()` so
 *     a hub-mounted Notes (`/notes/`), a parachute-app-mounted Notes
 *     (`/app/notes/`), and a renamed-install Notes (`/app/<slug>/`)
 *     all land back on a URL the SPA actually serves. The detector
 *     reads from `window.location.pathname` at call time — the same
 *     built bundle picks up the correct mount regardless of where
 *     it's served. See `src/lib/base-url.ts` for the contract.
 *   - Caller-supplied `params` (e.g. `vault=<name>` hint from the vault
 *     popover) appended without overwriting standard OAuth/PKCE params.
 *
 * Phase 2 of the notes-migration-to-app arc (parachute-app#6, design doc
 * section 16). The error classes and `storedFromTokenResponse` are
 * re-exports from app-client now — they were lifted byte-for-byte.
 */

import {
  PendingApprovalError,
  RefreshHttpError,
  type StoredToken,
  type TokenResponse,
  deriveCodeChallenge,
  generateCodeVerifier,
  generateState,
  storedFromTokenResponse,
} from "@openparachute/app-client";
import { detectMountBase } from "../base-url";
import { discoverAuthServer, registerClient } from "./discovery";
import {
  clearCachedClientId,
  clearPendingOAuth,
  loadCachedClientId,
  loadPendingOAuth,
  saveCachedClientId,
  savePendingOAuth,
} from "./storage";
import type { PendingOAuthState, TokenScope } from "./types";
import { normalizeVaultUrl } from "./url";

// Re-exports — app-client owns the implementations; preserved here so
// existing import sites (`import { PendingApprovalError, ... } from
// "@/lib/vault/oauth"`) don't churn.
export { PendingApprovalError, RefreshHttpError, clearCachedClientId, storedFromTokenResponse };

const REDIRECT_PATH = "/oauth/callback";
// Default scope vocabulary. `vault:read vault:write` per
// `parachute-patterns/oauth-scopes.md`. The legacy `"full"` synonym is still
// honoured by vault for one release cycle, but new connects request the new
// vocabulary so the hub can render an accurate consent screen.
export const DEFAULT_SCOPE: TokenScope = "vault:read vault:write";

// Notes can be mounted at several paths depending on the host:
//
//   - `/notes/`          (legacy notes-daemon)
//   - `/app/notes/`      (parachute-app default)
//   - `/app/<slug>/`     (parachute-app with a renamed install)
//
// The OAuth callback must include the live mount prefix so the
// authorization server bounces the browser back to a URL the SPA
// actually serves. `detectMountBase()` reads it from
// `window.location.pathname` at call time — works for every mount
// shape from the same built bundle. Returns the mount path WITHOUT a
// trailing slash; concatenated with `REDIRECT_PATH` (which carries its
// own leading slash) to form a clean callback path.
function basePathPrefix(): string {
  return detectMountBase();
}

export function redirectUriForOrigin(origin: string = window.location.origin): string {
  return `${origin.replace(/\/$/, "")}${basePathPrefix()}${REDIRECT_PATH}`;
}

export interface BeginOAuthOptions {
  /**
   * Extra query params appended to the authorize URL after the standard
   * OAuth + PKCE params. Used for hints the hub may consume (e.g. a
   * `vault=<name>` pre-selection hint from the Notes vault popover —
   * design doc 2026-05-12-notes-ui-audit §2). Unknown params are
   * harmless: a hub that doesn't recognize them ignores them and the
   * consent screen renders as today.
   */
  params?: Record<string, string>;
  /**
   * Vault id whose halt entry should be cleared on a successful OAuth
   * completion (notes#148). Set by the reconnect path so the originally
   * halted vault gets unblocked even when the hub's token catalog resolves
   * the vault to a different URL than what's currently stored — the new
   * vault entry would otherwise have a fresh (non-halted) id, leaving the
   * old halt orphaned in localStorage and the banner stuck on the next
   * activeVaultId switch. Round-trips via sessionStorage on the
   * PendingOAuthState; OAuthCallback consumes it.
   */
  priorHaltedVaultId?: string;
}

/**
 * Begin the OAuth 2.1 + PKCE flow against an issuer URL.
 *
 * `issuerInput` is whatever resolved an OAuth metadata document — under
 * hub-as-issuer this is the hub origin; for a standalone vault it's the
 * vault URL. Discovers the AS, reuses a cached client_id when present
 * (DCR runs at most once per issuer per browser), stashes PKCE state in
 * sessionStorage, and returns the URL the caller should redirect to.
 */
export async function beginOAuth(
  issuerInput: string,
  scope: TokenScope = DEFAULT_SCOPE,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
  options: BeginOAuthOptions = {},
): Promise<{ authorizeUrl: string; pending: PendingOAuthState }> {
  const issuerUrl = normalizeVaultUrl(issuerInput);
  const redirectUri = redirectUriForOrigin();

  const metadata = await discoverAuthServer(issuerUrl, fetchImpl);

  // Reuse cached client_id keyed by the metadata-reported issuer (not the
  // input URL) so a hub fronted at multiple aliases shares one registration.
  let clientId = loadCachedClientId(metadata.issuer, redirectUri);
  if (!clientId) {
    const registration = await registerClient(
      metadata.registration_endpoint,
      redirectUri,
      fetchImpl,
    );
    clientId = registration.client_id;
    saveCachedClientId(metadata.issuer, redirectUri, clientId);
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await deriveCodeChallenge(codeVerifier);
  const state = generateState();

  const pending: PendingOAuthState = {
    issuerUrl,
    issuer: metadata.issuer,
    tokenEndpoint: metadata.token_endpoint,
    clientId,
    codeVerifier,
    state,
    redirectUri,
    scope,
    startedAt: new Date().toISOString(),
    ...(options.priorHaltedVaultId ? { priorHaltedVaultId: options.priorHaltedVaultId } : {}),
  };
  savePendingOAuth(pending);

  const authorizeUrl = new URL(metadata.authorization_endpoint);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("scope", scope);
  // Appended last so caller-supplied params never overwrite the OAuth/PKCE
  // params above. A caller that passes `code_challenge` will see it ignored
  // — by design.
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (!authorizeUrl.searchParams.has(key)) {
        authorizeUrl.searchParams.set(key, value);
      }
    }
  }

  return { authorizeUrl: authorizeUrl.toString(), pending };
}

// Defense-in-depth: only render http(s) approve_urls. Even though the hub
// is in the trust boundary (the user pointed Notes at it), a malformed or
// hostile `javascript:` URL must never make it to a React `href` —
// stripping non-http(s) schemes here guarantees the UI can't accidentally
// surface one.
function safeApproveUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  return raw;
}

function parsePendingApproval(text: string): { approveUrl: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const body = parsed as Record<string, unknown>;
  if (body.error !== "invalid_client") return null;
  const approveUrl = safeApproveUrl(body.approve_url);
  // Hub still emits `cli_alternative` for terminal-comfortable operators, but
  // Notes no longer surfaces it — the web approval path is the path now.
  // Without an `approve_url`, we fall through to the generic error UI rather
  // than rendering an empty "Waiting for hub approval" screen.
  if (!approveUrl) return null;
  return { approveUrl };
}

/**
 * Complete the OAuth flow: verify state, POST the auth code + PKCE verifier to
 * the token endpoint, clear pending state.
 */
export async function completeOAuth(
  code: string,
  state: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<{ pending: PendingOAuthState; token: TokenResponse }> {
  const pending = loadPendingOAuth();
  if (!pending) {
    throw new Error("No pending OAuth flow. Start the connect flow from the vault page.");
  }
  if (pending.state !== state) {
    clearPendingOAuth();
    throw new Error("OAuth state mismatch. The flow was likely interrupted; please try again.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: pending.codeVerifier,
    client_id: pending.clientId,
    redirect_uri: pending.redirectUri,
  });

  const res = await fetchImpl(pending.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    clearPendingOAuth();
    const pendingApproval = parsePendingApproval(text);
    if (pendingApproval) {
      throw new PendingApprovalError(pendingApproval.approveUrl);
    }
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const token = (await res.json()) as TokenResponse;
  if (!token.access_token) {
    clearPendingOAuth();
    throw new Error("Token response missing access_token");
  }

  clearPendingOAuth();
  return { pending, token };
}

export interface RefreshContext {
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
}

/**
 * Exchange a refresh_token for a fresh access (+ rotated refresh) token.
 *
 * Hub#66 implements RFC 6749 §6 with refresh-token rotation: each successful
 * call returns a new `refresh_token` that supersedes the one passed in. The
 * caller must persist the rotated value or the next refresh will 400.
 *
 * Kept Notes-side rather than calling app-client's `ParachuteOAuth.
 * refreshAccessToken` because Notes' refresh path doesn't go through a
 * driver instance — `refresh.ts` reads the rotated metadata off
 * `VaultRecord` directly so the rotate can run from any 401 caller
 * without holding a reference to the OAuth class.
 */
export async function refreshAccessToken(
  ctx: RefreshContext,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: ctx.refreshToken,
    client_id: ctx.clientId,
  });

  const res = await fetchImpl(ctx.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new RefreshHttpError(res.status, text);
  }

  const token = (await res.json()) as TokenResponse;
  if (!token.access_token) {
    throw new Error("Refresh response missing access_token");
  }
  return token;
}

// Re-export StoredToken-conversion shape for callers that import it from
// here (refresh.ts, OAuthCallback). Notes' storedFromTokenResponse used to
// always set `vault` even when the token response omitted it; app-client's
// version mirrors that intent (sets `vault` only when present in the
// response, which matches RFC 6749 §4.1.4 and hub's actual behavior).
export type { StoredToken };
