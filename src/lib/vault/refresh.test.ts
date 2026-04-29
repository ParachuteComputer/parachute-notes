import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthHaltStore } from "./auth-halt-store";
import { forceRefresh } from "./refresh";
import { loadToken, saveToken } from "./storage";
import { useVaultStore } from "./store";
import type { StoredToken, VaultRecord } from "./types";

function seedVault(record: Partial<VaultRecord> & { id: string }): VaultRecord {
  const full: VaultRecord = {
    id: record.id,
    url: record.url ?? "http://localhost:1940",
    name: record.name ?? "default",
    issuer: record.issuer ?? "http://localhost:1939",
    // Fallback only when caller hasn't named the key at all. Explicit
    // `tokenEndpoint: undefined` round-trips so legacy-record tests can assert
    // the no-refresh path.
    tokenEndpoint:
      "tokenEndpoint" in record ? record.tokenEndpoint : "http://localhost:1939/oauth/token",
    clientId: record.clientId ?? "client-123",
    scope: record.scope ?? "vault:read vault:write",
    addedAt: record.addedAt ?? "2026-04-25T00:00:00Z",
    lastUsedAt: record.lastUsedAt ?? "2026-04-25T00:00:00Z",
  };
  useVaultStore.setState({ vaults: { [full.id]: full }, activeVaultId: full.id });
  return full;
}

function seedToken(id: string, token: Partial<StoredToken>) {
  const stored: StoredToken = {
    accessToken: token.accessToken ?? "eyJ.stale",
    scope: token.scope ?? "vault:read vault:write",
    vault: token.vault ?? "default",
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
  };
  saveToken(id, stored);
}

describe("forceRefresh", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useAuthHaltStore.setState({ byVault: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useAuthHaltStore.setState({ byVault: {} });
  });

  it("posts grant_type=refresh_token, persists the rotated token, and returns the new access token", async () => {
    seedVault({ id: "v1" });
    seedToken("v1", { accessToken: "eyJ.stale", refreshToken: "rt_old" });

    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "eyJ.new",
            token_type: "bearer",
            scope: "vault:read vault:write",
            vault: "default",
            refresh_token: "rt_rotated",
            expires_in: 900,
          }),
          text: async () => "",
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchImpl);

    const access = await forceRefresh("v1");
    expect(access).toBe("eyJ.new");

    const stored = loadToken("v1");
    expect(stored?.accessToken).toBe("eyJ.new");
    expect(stored?.refreshToken).toBe("rt_rotated");
    expect(stored?.expiresAt).toBeGreaterThan(Date.now());

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt_old");
  });

  it("returns null when the stored token has no refresh_token (legacy pvt_*)", async () => {
    seedVault({ id: "v1" });
    seedToken("v1", { accessToken: "pvt_abc" });

    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchImpl);

    expect(await forceRefresh("v1")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null when the vault record predates hub-as-issuer (no tokenEndpoint)", async () => {
    seedVault({ id: "v1", tokenEndpoint: undefined });
    seedToken("v1", { refreshToken: "rt_old" });

    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchImpl);

    expect(await forceRefresh("v1")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null and leaves the stored token intact when the exchange fails", async () => {
    seedVault({ id: "v1" });
    seedToken("v1", { accessToken: "eyJ.stale", refreshToken: "rt_old" });

    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        ({
          ok: false,
          status: 400,
          json: async () => ({}),
          text: async () => "invalid_grant",
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchImpl);

    expect(await forceRefresh("v1")).toBeNull();
    expect(loadToken("v1")?.accessToken).toBe("eyJ.stale");
    expect(loadToken("v1")?.refreshToken).toBe("rt_old");
  });

  it("marks the vault auth-halted when the hub answers with invalid_grant", async () => {
    seedVault({ id: "v1" });
    seedToken("v1", { accessToken: "eyJ.stale", refreshToken: "rt_old" });

    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        ({
          ok: false,
          status: 400,
          json: async () => ({ error: "invalid_grant" }),
          text: async () => '{"error":"invalid_grant"}',
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchImpl);

    expect(await forceRefresh("v1")).toBeNull();
    const halt = useAuthHaltStore.getState().byVault.v1;
    expect(halt).toBeDefined();
    expect(halt?.reason).toMatch(/expired|reconnect/i);
  });

  it("marks the vault auth-halted when the hub answers with any 4xx", async () => {
    seedVault({ id: "v1" });
    seedToken("v1", { accessToken: "eyJ.stale", refreshToken: "rt_old" });

    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        ({
          ok: false,
          status: 401,
          json: async () => ({}),
          text: async () => "unauthorized_client",
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchImpl);

    expect(await forceRefresh("v1")).toBeNull();
    expect(useAuthHaltStore.getState().byVault.v1).toBeDefined();
  });

  it("does NOT mark halted on a network-level error (transient — let the next tick retry)", async () => {
    seedVault({ id: "v1" });
    seedToken("v1", { accessToken: "eyJ.stale", refreshToken: "rt_old" });

    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchImpl);

    expect(await forceRefresh("v1")).toBeNull();
    expect(useAuthHaltStore.getState().byVault.v1).toBeUndefined();
  });

  it("clears any prior halt on a successful refresh", async () => {
    seedVault({ id: "v1" });
    seedToken("v1", { accessToken: "eyJ.stale", refreshToken: "rt_old" });
    useAuthHaltStore.getState().markHalted("v1", "stale halt from earlier");

    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "eyJ.new",
            token_type: "bearer",
            scope: "vault:read vault:write",
            vault: "default",
            refresh_token: "rt_rotated",
            expires_in: 900,
          }),
          text: async () => "",
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchImpl);

    const access = await forceRefresh("v1");
    expect(access).toBe("eyJ.new");
    expect(useAuthHaltStore.getState().byVault.v1).toBeUndefined();
  });

  it("dedupes concurrent refreshes so refresh-token rotation only consumes one prior token", async () => {
    seedVault({ id: "v1" });
    seedToken("v1", { accessToken: "eyJ.stale", refreshToken: "rt_old" });

    let calls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      calls += 1;
      // Resolve on next microtask to give the second caller time to land in the
      // dedupe map before this promise settles.
      await Promise.resolve();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "eyJ.new",
          token_type: "bearer",
          scope: "vault:read vault:write",
          vault: "default",
          refresh_token: "rt_rotated",
          expires_in: 900,
        }),
        text: async () => "",
      } as Response;
    });
    vi.stubGlobal("fetch", fetchImpl);

    const [a, b] = await Promise.all([forceRefresh("v1"), forceRefresh("v1")]);
    expect(a).toBe("eyJ.new");
    expect(b).toBe("eyJ.new");
    expect(calls).toBe(1);
  });
});
