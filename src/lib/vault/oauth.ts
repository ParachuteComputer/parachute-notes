import { discoverAuthServer, registerClient } from "./discovery";
import { deriveCodeChallenge, generateCodeVerifier, generateState } from "./pkce";
import { clearPendingOAuth, loadPendingOAuth, savePendingOAuth } from "./storage";
import type { PendingOAuthState, TokenResponse, TokenScope } from "./types";
import { normalizeVaultUrl } from "./url";

const REDIRECT_PATH = "/oauth/callback";

// Notes is mounted under `import.meta.env.BASE_URL` (defaults to `/`, can be
// `/notes/` when the CLI's expose tooling path-routes us). The OAuth callback
// must include that prefix so the authorization server bounces the browser
// back to a URL the SPA actually serves.
function basePathPrefix(): string {
  const b = import.meta.env.BASE_URL ?? "/";
  return b.replace(/\/$/, "");
}

export function redirectUriForOrigin(origin: string = window.location.origin): string {
  return `${origin.replace(/\/$/, "")}${basePathPrefix()}${REDIRECT_PATH}`;
}

/**
 * Begin the OAuth 2.1 + PKCE flow against `rawUrl`.
 *
 * Discovers the authorization server, registers a client, stashes the PKCE
 * verifier + state in sessionStorage, and returns the URL the caller should
 * redirect the browser to. The caller is responsible for the redirect so the
 * returned URL stays visible in tests.
 */
export async function beginOAuth(
  rawUrl: string,
  scope: TokenScope = "full",
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<{ authorizeUrl: string; pending: PendingOAuthState }> {
  const vaultUrl = normalizeVaultUrl(rawUrl);
  const redirectUri = redirectUriForOrigin();

  const metadata = await discoverAuthServer(vaultUrl, fetchImpl);
  const registration = await registerClient(metadata.registration_endpoint, redirectUri, fetchImpl);

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await deriveCodeChallenge(codeVerifier);
  const state = generateState();

  const pending: PendingOAuthState = {
    vaultUrl,
    issuer: metadata.issuer,
    tokenEndpoint: metadata.token_endpoint,
    clientId: registration.client_id,
    codeVerifier,
    state,
    redirectUri,
    scope,
    startedAt: new Date().toISOString(),
  };
  savePendingOAuth(pending);

  const authorizeUrl = new URL(metadata.authorization_endpoint);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", registration.client_id);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("scope", scope);

  return { authorizeUrl: authorizeUrl.toString(), pending };
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
