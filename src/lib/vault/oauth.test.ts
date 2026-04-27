import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginOAuth,
  completeOAuth,
  redirectUriForOrigin,
  refreshAccessToken,
  storedFromTokenResponse,
} from "./oauth";
import { deriveCodeChallenge } from "./pkce";
import { clearCachedClientId, loadPendingOAuth, savePendingOAuth } from "./storage";
import type { PendingOAuthState } from "./types";

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
});

describe("redirectUriForOrigin under VITE_BASE_PATH", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to {origin}/oauth/callback when base is /", () => {
    vi.stubEnv("BASE_URL", "/");
    expect(redirectUriForOrigin("http://localhost:3000")).toBe(
      "http://localhost:3000/oauth/callback",
    );
  });

  it("includes the base path when Notes is mounted under a sub-path", () => {
    vi.stubEnv("BASE_URL", "/notes/");
    expect(redirectUriForOrigin("http://host.example")).toBe(
      "http://host.example/notes/oauth/callback",
    );
  });

  it("strips a single trailing slash on the origin and the base", () => {
    vi.stubEnv("BASE_URL", "/notes/");
    expect(redirectUriForOrigin("http://host.example/")).toBe(
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

describe("storedFromTokenResponse", () => {
  it("computes an absolute expiresAt from expires_in", () => {
    const stored = storedFromTokenResponse(
      {
        access_token: "eyJ.a",
        token_type: "bearer",
        scope: "vault:read",
        vault: "default",
        refresh_token: "rt_a",
        expires_in: 900,
      },
      1_700_000_000_000,
    );
    expect(stored.accessToken).toBe("eyJ.a");
    expect(stored.refreshToken).toBe("rt_a");
    expect(stored.expiresAt).toBe(1_700_000_900_000);
  });

  it("omits refreshToken / expiresAt for legacy pvt_* tokens", () => {
    const stored = storedFromTokenResponse({
      access_token: "pvt_abc",
      token_type: "bearer",
      scope: "vault:read",
      vault: "default",
    });
    expect(stored.refreshToken).toBeUndefined();
    expect(stored.expiresAt).toBeUndefined();
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
