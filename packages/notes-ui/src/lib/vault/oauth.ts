import { discoverAuthServer, registerClient } from "./discovery";
import { deriveCodeChallenge, generateCodeVerifier, generateState } from "./pkce";
import {
  clearCachedClientId,
  clearPendingOAuth,
  loadCachedClientId,
  loadPendingOAuth,
  saveCachedClientId,
  savePendingOAuth,
} from "./storage";
import type { PendingOAuthState, StoredToken, TokenResponse, TokenScope } from "./types";
import { normalizeVaultUrl } from "./url";

const REDIRECT_PATH = "/oauth/callback";
// Default scope vocabulary. `vault:read vault:write` per
// `parachute-patterns/oauth-scopes.md`. The legacy `"full"` synonym is still
// honoured by vault for one release cycle, but new connects request the new
// vocabulary so the hub can render an accurate consent screen.
export const DEFAULT_SCOPE: TokenScope = "vault:read vault:write";

// Notes is mounted under `import.meta.env.BASE_URL` (defaults to `/`, can be
// `/notes/` when the hub portal path-routes us). The OAuth callback must
// include that prefix so the authorization server bounces the browser back to
// a URL the SPA actually serves.
function basePathPrefix(): string {
  const b = import.meta.env.BASE_URL ?? "/";
  return b.replace(/\/$/, "");
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
 * Thrown by `completeOAuth` when the token endpoint answers with
 * `error: "invalid_client"` for a client that's registered but pending
 * operator approval (hub#74 / hub#240). Carries the actionability hint
 * the hub now includes alongside the OAuth error so the UI can render a
 * one-click "approve in hub" path:
 *
 *   - `approveUrl` — hub-served SPA route (`/admin/approve-client/<id>`)
 *     the operator can open to approve the client inline. Same-origin
 *     to the hub. `parsePendingApproval` returns `null` (and
 *     `completeOAuth` falls through to the generic token-exchange
 *     error) when the hub omits it, so by the time this error is
 *     thrown, `approveUrl` is guaranteed to be a valid http(s) string.
 *
 * Hub still emits a `cli_alternative` shell command in the same response
 * for terminal-comfortable operators, but Notes no longer surfaces it —
 * the wizard-era goal is "everything from a browser."
 */
export class PendingApprovalError extends Error {
  readonly approveUrl: string;

  constructor(approveUrl: string) {
    super("Your hub needs to approve this app before sign-in can complete.");
    this.name = "PendingApprovalError";
    this.approveUrl = approveUrl;
  }
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

/**
 * Convert a token-endpoint response into the on-disk shape, computing
 * `expiresAt` from `expires_in` so the 401-driven refresh path can compare a
 * single absolute timestamp.
 */
export function storedFromTokenResponse(
  token: TokenResponse,
  now: number = Date.now(),
): StoredToken {
  const stored: StoredToken = {
    accessToken: token.access_token,
    scope: token.scope,
    vault: token.vault,
  };
  if (token.refresh_token) stored.refreshToken = token.refresh_token;
  if (typeof token.expires_in === "number") {
    stored.expiresAt = now + token.expires_in * 1000;
  }
  return stored;
}

export interface RefreshContext {
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
}

// Thrown by `refreshAccessToken` when the hub answered with a non-2xx —
// distinct from a network error so callers can tell "server rejected our
// refresh token" (revoked / rotated past us; surface a reconnect prompt) apart
// from "couldn't reach the hub at all" (transient; let the next sync tick
// retry quietly).
export class RefreshHttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly oauthError?: string;

  constructor(status: number, body: string) {
    let oauthError: string | undefined;
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      if (typeof parsed.error === "string") oauthError = parsed.error;
    } catch {
      // Body wasn't JSON — fine; some hubs return text on infra errors.
    }
    super(`Token refresh failed (${status}): ${body}`);
    this.name = "RefreshHttpError";
    this.status = status;
    this.body = body;
    this.oauthError = oauthError;
  }
}

/**
 * Exchange a refresh_token for a fresh access (+ rotated refresh) token.
 *
 * Hub#66 implements RFC 6749 §6 with refresh-token rotation: each successful
 * call returns a new `refresh_token` that supersedes the one passed in. The
 * caller must persist the rotated value or the next refresh will 400.
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

// Re-exported so call sites that need to invalidate a cached client_id (e.g.
// hub returns 4xx client_not_found on /oauth/authorize) don't have to import
// from storage directly.
export { clearCachedClientId };
