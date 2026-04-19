import { beforeEach, describe, expect, it, vi } from "vitest";
import { beginOAuth, completeOAuth } from "./oauth";
import { deriveCodeChallenge } from "./pkce";
import { loadPendingOAuth, savePendingOAuth } from "./storage";
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
  scopes_supported: ["full", "read"],
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
    window.history.replaceState({}, "", "http://localhost:3000/");
  });

  it("discovers, registers, and returns an authorize URL with PKCE params", async () => {
    const fetchImpl = mockFetch([{ json: validMetadata }, { json: clientReg }]);
    const { authorizeUrl, pending } = await beginOAuth("http://localhost:1940", "full", fetchImpl);

    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe("http://localhost:1940/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/oauth/callback");
    expect(url.searchParams.get("scope")).toBe("full");

    const challenge = url.searchParams.get("code_challenge");
    expect(challenge).toBe(await deriveCodeChallenge(pending.codeVerifier));

    const persisted = loadPendingOAuth();
    expect(persisted?.state).toBe(pending.state);
    expect(persisted?.codeVerifier).toBe(pending.codeVerifier);
    expect(persisted?.vaultUrl).toBe("http://localhost:1940");
  });

  it("normalizes user-entered URLs before discovery", async () => {
    const fetchImpl = mockFetch([{ json: validMetadata }, { json: clientReg }]);
    await beginOAuth("http://localhost:1940/api/", "full", fetchImpl);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "http://localhost:1940/.well-known/oauth-authorization-server",
    );
  });
});

describe("completeOAuth", () => {
  const pending: PendingOAuthState = {
    vaultUrl: "http://localhost:1940",
    issuer: "http://localhost:1940",
    tokenEndpoint: "http://localhost:1940/oauth/token",
    clientId: "client-123",
    codeVerifier: "verifier-abc",
    state: "state-xyz",
    redirectUri: "http://localhost:3000/oauth/callback",
    scope: "full",
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
          access_token: "pvt_abc",
          token_type: "bearer",
          scope: "full",
          vault: "default",
        },
      },
    ]);
    const { token } = await completeOAuth("auth-code", "state-xyz", fetchImpl);
    expect(token.access_token).toBe("pvt_abc");
    expect(token.vault).toBe("default");
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
});
