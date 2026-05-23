import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PendingApprovalError,
  beginOAuth,
  completeOAuth,
  redirectUriForOrigin,
  refreshAccessToken,
} from "./oauth";
import { deriveCodeChallenge } from "./pkce";
import { clearCachedClientId, loadPendingOAuth, savePendingOAuth } from "./storage";
import type { PendingOAuthState } from "./types";

// `storedFromTokenResponse` is now a re-export from
// `@openparachute/app-client` (Phase 2, parachute-app#6) — its unit
// tests live in app-client's own suite. `refreshAccessToken` stays
// Notes-side because it's wired into refresh.ts without the
// ParachuteOAuth driver class. The `beginOAuth` + `completeOAuth` tests
// below still cover Notes-specific orchestration: priorHaltedVaultId,
// caller-supplied params, the cached client_id reuse pattern, and the
// PendingApprovalError fallback shape.

const validMetadata = {
  issuer: "http://localhost:1940",
  authorization_endpoint: "http://localhost:1940/oauth/authorize",
  token_endpoint: "http://localhost:1940/oauth/token",
  registration_endpoint: "http://localhost:1940/oauth/register",
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["S256"],
  grant_types_supported: ["authorization_code"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: ["vault:read", "vault:write", "vault:admin"],
};

const clientReg = {
  client_id: "client-123",
  client_name: "Parachute Notes",
  redirect_uris: ["http://localhost:3000/oauth/callback"],
};

function mockFetch(
  responses: Array<{ ok?: boolean; status?: number; json?: unknown; text?: string }>,
) {
  const queue = [...responses];
  return vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected fetch call");
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: async () => next.json,
      text: async () => next.text ?? "",
    } as Response;
  });
}

describe("beginOAuth", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, "", "http://localhost:3000/");
  });

  it("discovers, registers, and returns an authorize URL with PKCE params", async () => {
    const fetchImpl = mockFetch([{ json: validMetadata }, { json: clientReg }]);
    const { authorizeUrl, pending } = await beginOAuth(
      "http://localhost:1940",
      "vault:read vault:write",
      fetchImpl,
    );

    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe("http://localhost:1940/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/notes/oauth/callback");
    expect(url.searchParams.get("scope")).toBe("vault:read vault:write");

    const challenge = url.searchParams.get("code_challenge");
    expect(challenge).toBe(await deriveCodeChallenge(pending.codeVerifier));

    const persisted = loadPendingOAuth();
    expect(persisted?.state).toBe(pending.state);
    expect(persisted?.codeVerifier).toBe(pending.codeVerifier);
    expect(persisted?.issuerUrl).toBe("http://localhost:1940");
    expect(persisted?.tokenEndpoint).toBe("http://localhost:1940/oauth/token");
  });

  it("normalizes user-entered URLs before discovery", async () => {
    const fetchImpl = mockFetch([{ json: validMetadata }, { json: clientReg }]);
    await beginOAuth("http://localhost:1940/api/", "vault:read", fetchImpl);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "http://localhost:1940/.well-known/oauth-authorization-server",
    );
  });

  it("reuses a cached client_id on the second connect to the same issuer", async () => {
    // First connect: discover + register. Second connect: discover only —
    // registration is skipped because the cached client_id matches.
    const first = mockFetch([{ json: validMetadata }, { json: clientReg }]);
    await beginOAuth("http://localhost:1940", "vault:read", first);
    expect(first).toHaveBeenCalledTimes(2);

    const second = mockFetch([{ json: validMetadata }]);
    const { pending } = await beginOAuth("http://localhost:1940", "vault:read", second);
    expect(second).toHaveBeenCalledTimes(1);
    expect(pending.clientId).toBe("client-123");
  });

  it("appends caller-supplied `params` to the authorize URL", async () => {
    const fetchImpl = mockFetch([{ json: validMetadata }, { json: clientReg }]);
    const { authorizeUrl } = await beginOAuth("http://localhost:1940", "vault:read", fetchImpl, {
      params: { vault: "techne" },
    });
    const url = new URL(authorizeUrl);
    expect(url.searchParams.get("vault")).toBe("techne");
    // Standard OAuth/PKCE params still present and unmodified.
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("never lets `params` overwrite a standard OAuth/PKCE param", async () => {
    const fetchImpl = mockFetch([{ json: validMetadata }, { json: clientReg }]);
    const { authorizeUrl } = await beginOAuth("http://localhost:1940", "vault:read", fetchImpl, {
      params: { response_type: "token", scope: "evil:scope", vault: "techne" },
    });
    const url = new URL(authorizeUrl);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("vault:read");
    expect(url.searchParams.get("vault")).toBe("techne");
  });

  it("re-registers when the redirect URI no longer matches the cache", async () => {
    const first = mockFetch([{ json: validMetadata }, { json: clientReg }]);
    await beginOAuth("http://localhost:1940", "vault:read", first);

    // Manually invalidate by recording a stale entry under the issuer key.
    // Easier than monkey-patching `BASE_URL` mid-test.
    clearCachedClientId("http://localhost:1940");

    const second = mockFetch([{ json: validMetadata }, { json: clientReg }]);
    await beginOAuth("http://localhost:1940", "vault:read", second);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("stashes priorHaltedVaultId on the pending state for OAuthCallback to consume", async () => {
    // notes#148 — the reconnect path threads the currently-halted vault id
    // through the OAuth round-trip so the callback can clear THAT vault's
    // halt entry on success, even when the new vault url resolves to a
    // different vaultIdFromUrl. Pin the round-trip storage.
    const fetchImpl = mockFetch([{ json: validMetadata }, { json: clientReg }]);
    const { pending } = await beginOAuth("http://localhost:1940", "vault:read", fetchImpl, {
      priorHaltedVaultId: "old-vault-id",
    });
    expect(pending.priorHaltedVaultId).toBe("old-vault-id");
    const loaded = loadPendingOAuth();
    expect(loaded?.priorHaltedVaultId).toBe("old-vault-id");
  });

  it("omits priorHaltedVaultId on the pending state when caller doesn't pass one", async () => {
    // Cold-connect path from /add should never carry a stale halt id.
    const fetchImpl = mockFetch([{ json: validMetadata }, { json: clientReg }]);
    const { pending } = await beginOAuth("http://localhost:1940", "vault:read", fetchImpl);
    expect(pending.priorHaltedVaultId).toBeUndefined();
    const loaded = loadPendingOAuth();
    expect(loaded?.priorHaltedVaultId).toBeUndefined();
  });
});

describe("redirectUriForOrigin under runtime mount detection", () => {
  // detectMountBase() reads from window.location.pathname (not
  // import.meta.env.BASE_URL — that was the pre-2026-05-23 shape). The
  // OAuth tests above default-stub the path to `/notes/` in beforeEach,
  // matching the legacy-daemon mount. These tests drive each recognised
  // mount path through the redirect-URI derivation. jsdom forbids
  // cross-origin replaceState so the path is changed in-place; the
  // origin passed to `redirectUriForOrigin` is the externally visible
  // URL the SPA was loaded from (independent of the test's actual origin).
  it("includes the legacy /notes mount when served from /notes/...", () => {
    window.history.replaceState({}, "", "/notes/");
    expect(redirectUriForOrigin("http://host.example")).toBe(
      "http://host.example/notes/oauth/callback",
    );
  });

  it("includes the parachute-app default mount when served from /app/notes/...", () => {
    window.history.replaceState({}, "", "/app/notes/");
    expect(redirectUriForOrigin("http://host.example")).toBe(
      "http://host.example/app/notes/oauth/callback",
    );
  });

  it("includes a renamed-install slug when served from /app/<slug>/...", () => {
    window.history.replaceState({}, "", "/app/my-notes/");
    expect(redirectUriForOrigin("http://host.example")).toBe(
      "http://host.example/app/my-notes/oauth/callback",
    );
  });

  it("strips a single trailing slash on the origin", () => {
    window.history.replaceState({}, "", "/notes/");
    expect(redirectUriForOrigin("http://host.example/")).toBe(
      "http://host.example/notes/oauth/callback",
    );
  });

  it("falls back to /notes/oauth/callback for unrecognised mounts (defensive)", () => {
    // Bare origin or any unrecognised pathname falls through to the legacy
    // default — better than blanking the redirect URI. Real-world mounts
    // are always one of the cases above.
    window.history.replaceState({}, "", "/");
    expect(redirectUriForOrigin("http://host.example")).toBe(
      "http://host.example/notes/oauth/callback",
    );
  });
});

describe("completeOAuth", () => {
  const pending: PendingOAuthState = {
    issuerUrl: "http://localhost:1940",
    issuer: "http://localhost:1940",
    tokenEndpoint: "http://localhost:1940/oauth/token",
    clientId: "client-123",
    codeVerifier: "verifier-abc",
    state: "state-xyz",
    redirectUri: "http://localhost:3000/oauth/callback",
    scope: "vault:read vault:write",
    startedAt: "2026-04-18T00:00:00.000Z",
  };

  beforeEach(() => {
    sessionStorage.clear();
  });

  it("exchanges the code and clears pending state", async () => {
    savePendingOAuth(pending);
    const fetchImpl = mockFetch([
      {
        json: {
          access_token: "eyJ.jwt.payload",
          token_type: "bearer",
          scope: "vault:read vault:write",
          vault: "default",
          refresh_token: "rt_abc",
          expires_in: 900,
        },
      },
    ]);
    const { token } = await completeOAuth("auth-code", "state-xyz", fetchImpl);
    expect(token.access_token).toBe("eyJ.jwt.payload");
    expect(token.vault).toBe("default");
    expect(token.refresh_token).toBe("rt_abc");
    expect(token.expires_in).toBe(900);
    expect(loadPendingOAuth()).toBeNull();

    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe("http://localhost:1940/oauth/token");
    const init = call?.[1] as RequestInit;
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("code_verifier")).toBe("verifier-abc");
    expect(body.get("client_id")).toBe("client-123");
  });

  it("rejects a state mismatch and clears pending state", async () => {
    savePendingOAuth(pending);
    const fetchImpl = mockFetch([]);
    await expect(completeOAuth("auth-code", "wrong-state", fetchImpl)).rejects.toThrow(
      /state mismatch/i,
    );
    expect(loadPendingOAuth()).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws when no pending flow exists", async () => {
    const fetchImpl = mockFetch([]);
    await expect(completeOAuth("auth-code", "state-xyz", fetchImpl)).rejects.toThrow(/no pending/i);
  });

  it("surfaces vault-side token errors", async () => {
    savePendingOAuth(pending);
    const fetchImpl = mockFetch([{ ok: false, status: 400, text: '{"error":"invalid_grant"}' }]);
    await expect(completeOAuth("auth-code", "state-xyz", fetchImpl)).rejects.toThrow(
      /token exchange failed.*invalid_grant/i,
    );
    expect(loadPendingOAuth()).toBeNull();
  });

  it("throws PendingApprovalError with hub#240 hints when the client is unapproved", async () => {
    savePendingOAuth(pending);
    const approveUrl = "http://localhost:1940/admin/approve-client/client-123";
    const fetchImpl = mockFetch([
      {
        ok: false,
        status: 401,
        text: JSON.stringify({
          error: "invalid_client",
          error_description: "client is registered but has not been approved by the hub operator",
          approve_url: approveUrl,
          // Hub still emits cli_alternative; Notes no longer reads it.
          cli_alternative: "parachute auth approve-client client-123",
        }),
      },
    ]);
    let caught: unknown;
    try {
      await completeOAuth("auth-code", "state-xyz", fetchImpl);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PendingApprovalError);
    const e = caught as PendingApprovalError;
    expect(e.approveUrl).toBe(approveUrl);
    expect(loadPendingOAuth()).toBeNull();
  });

  it("falls back to the generic error when invalid_client omits approve_url", async () => {
    // Pre-#240 hubs (or any response missing approve_url) used to surface a
    // friendly "Waiting for hub approval" screen anchored on cli_alternative.
    // Notes no longer surfaces the CLI fallback — without an approve_url
    // there's nothing for the user to click, so we let the generic
    // token-exchange error render rather than show an empty friendly screen.
    savePendingOAuth(pending);
    const fetchImpl = mockFetch([
      {
        ok: false,
        status: 401,
        text: JSON.stringify({
          error: "invalid_client",
          error_description: "client pending approval",
          cli_alternative: "parachute auth approve-client client-123",
        }),
      },
    ]);
    await expect(completeOAuth("auth-code", "state-xyz", fetchImpl)).rejects.toThrow(
      /token exchange failed/i,
    );
  });

  it("strips non-http(s) approve_url schemes (javascript: defense-in-depth)", async () => {
    // A hostile or malformed hub must not be able to land a `javascript:`
    // URL in a React `href`. The scheme allowlist drops it. With Notes no
    // longer surfacing cli_alternative, a dropped approve_url means we fall
    // through to the generic token-exchange error rather than the friendly
    // pending-approval screen.
    savePendingOAuth(pending);
    const fetchImpl = mockFetch([
      {
        ok: false,
        status: 401,
        text: JSON.stringify({
          error: "invalid_client",
          error_description: "client pending approval",
          approve_url: "javascript:alert(1)",
          cli_alternative: "parachute auth approve-client client-123",
        }),
      },
    ]);
    await expect(completeOAuth("auth-code", "state-xyz", fetchImpl)).rejects.toThrow(
      /token exchange failed/i,
    );
  });

  it("preserves https approve_url and drops it if scheme is unparseable", async () => {
    // Trust boundary is at the hub-pointing decision, not at the URL
    // contents — any https URL the hub returns is rendered. An unparseable
    // string is dropped via the URL constructor catch, which (now that
    // cli_alternative is no longer rendered) falls through to the generic
    // token-exchange error.
    savePendingOAuth(pending);
    const httpsCase = mockFetch([
      {
        ok: false,
        status: 401,
        text: JSON.stringify({
          error: "invalid_client",
          error_description: "client pending approval",
          approve_url: "https://evil.example/.malicious/path",
        }),
      },
    ]);
    let httpsCaught: unknown;
    try {
      await completeOAuth("auth-code", "state-xyz", httpsCase);
    } catch (err) {
      httpsCaught = err;
    }
    expect((httpsCaught as PendingApprovalError).approveUrl).toBe(
      "https://evil.example/.malicious/path",
    );

    savePendingOAuth(pending);
    const garbageCase = mockFetch([
      {
        ok: false,
        status: 401,
        text: JSON.stringify({
          error: "invalid_client",
          error_description: "client pending approval",
          approve_url: "not a url at all",
        }),
      },
    ]);
    await expect(completeOAuth("auth-code", "state-xyz", garbageCase)).rejects.toThrow(
      /token exchange failed/i,
    );
  });

  it("falls back to the generic error when invalid_client lacks an approve_url", async () => {
    // A bare `invalid_client` (e.g. unknown client_id, revoked client) is a
    // distinct error family from pending-approval — shouldn't get swallowed
    // into the friendly UI.
    savePendingOAuth(pending);
    const fetchImpl = mockFetch([
      {
        ok: false,
        status: 401,
        text: JSON.stringify({
          error: "invalid_client",
          error_description: "client not found",
        }),
      },
    ]);
    await expect(completeOAuth("auth-code", "state-xyz", fetchImpl)).rejects.toThrow(
      /token exchange failed/i,
    );
  });

  it("returns the non-standard services catalog when the hub embeds it (Phase 1)", async () => {
    // Hub-issued token responses carry a `services` object so clients can
    // skip asking for the vault URL. Vault-issued tokens omit it — that
    // back-compat is exercised by the "exchanges the code…" test above.
    savePendingOAuth(pending);
    const fetchImpl = mockFetch([
      {
        json: {
          access_token: "eyJ.jwt.payload",
          token_type: "bearer",
          scope: "vault:read vault:write",
          vault: "default",
          services: {
            vault: { url: "https://parachute.x.ts.net/vault/default", version: "0.3.0" },
            scribe: { url: "https://parachute.x.ts.net/scribe", version: "0.2.0" },
          },
        },
      },
    ]);
    const { token } = await completeOAuth("auth-code", "state-xyz", fetchImpl);
    expect(token.services?.vault?.url).toBe("https://parachute.x.ts.net/vault/default");
    expect(token.services?.scribe?.url).toBe("https://parachute.x.ts.net/scribe");
  });
});

describe("refreshAccessToken", () => {
  it("posts grant_type=refresh_token and returns the rotated token", async () => {
    const fetchImpl = mockFetch([
      {
        json: {
          access_token: "eyJ.new",
          token_type: "bearer",
          scope: "vault:read vault:write",
          vault: "default",
          refresh_token: "rt_rotated",
          expires_in: 900,
        },
      },
    ]);
    const token = await refreshAccessToken(
      {
        tokenEndpoint: "http://localhost:1939/oauth/token",
        clientId: "client-123",
        refreshToken: "rt_old",
      },
      fetchImpl,
    );
    expect(token.access_token).toBe("eyJ.new");
    expect(token.refresh_token).toBe("rt_rotated");
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt_old");
    expect(body.get("client_id")).toBe("client-123");
  });

  it("throws on a 4xx response", async () => {
    const fetchImpl = mockFetch([{ ok: false, status: 400, text: '{"error":"invalid_grant"}' }]);
    await expect(
      refreshAccessToken(
        { tokenEndpoint: "http://x/oauth/token", clientId: "c", refreshToken: "rt" },
        fetchImpl,
      ),
    ).rejects.toThrow(/refresh failed.*invalid_grant/i);
  });
});
