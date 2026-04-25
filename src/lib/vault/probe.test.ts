import { describe, expect, it, vi } from "vitest";
import { probeForVault, probeVaultAtOrigin, shouldTryLocalHubFallback } from "./probe";

const validMetadata = {
  issuer: "https://h.example/vault/default",
  authorization_endpoint: "https://h.example/vault/default/oauth/authorize",
  token_endpoint: "https://h.example/vault/default/oauth/token",
  registration_endpoint: "https://h.example/vault/default/oauth/register",
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["S256"],
  grant_types_supported: ["authorization_code"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: ["full", "read"],
};

interface MockResponse {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
}

// Fetch mock that routes by URL substring. The probe makes two kinds of calls
// (parachute.json + oauth metadata) and a flat queue would be brittle if the
// order changes.
function routedFetch(routes: Record<string, MockResponse | "network-error">) {
  return vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pattern, response] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        if (response === "network-error") throw new Error("network down");
        return {
          ok: response.ok ?? true,
          status: response.status ?? 200,
          json: async () => response.json,
          text: async () => response.text ?? "",
        } as Response;
      }
    }
    throw new Error(`unmatched fetch: ${url}`);
  });
}

describe("probeVaultAtOrigin", () => {
  it("prefers parachute.json so a hub URL resolves to its vault, not the portal origin", async () => {
    // Regression guard: hub origin serves BOTH a parachute.json registry AND
    // direct OAuth metadata (it proxies vault's metadata at the portal root).
    // If we probed direct OAuth first, we'd return the hub origin — but the
    // hub isn't a vault, it's a portal. `/api/notes` on the hub doesn't exist
    // and every API call would 404. Registry-first ensures we end up at
    // `${hub}/vault/<name>`.
    const fetchImpl = routedFetch({
      "/.well-known/parachute.json": {
        json: { vault: { url: "https://hub.example/vault/default" } },
      },
      "/vault/default/.well-known/oauth-authorization-server": { json: validMetadata },
      // Direct OAuth would also succeed at the hub, but we should never reach
      // it — the registry win short-circuits the fallback.
      "https://hub.example/.well-known/oauth-authorization-server": { json: validMetadata },
    });
    const result = await probeVaultAtOrigin("https://hub.example", 500, fetchImpl);
    expect(result).toBe("https://hub.example/vault/default");
  });

  it("prefers the entry named `default` from a multi-vault parachute.json", async () => {
    const fetchImpl = routedFetch({
      "/.well-known/parachute.json": {
        json: {
          vaults: [
            { name: "work", url: "https://h.example/vault/work" },
            { name: "default", url: "https://h.example/vault/default" },
          ],
        },
      },
      "/vault/default/.well-known/oauth-authorization-server": { json: validMetadata },
    });
    const result = await probeVaultAtOrigin("https://h.example", 500, fetchImpl);
    expect(result).toBe("https://h.example/vault/default");
  });

  it("falls back to direct OAuth for a bare standalone vault with no registry", async () => {
    // Standalone vault case: user pastes `http://localhost:1940`. No
    // parachute.json served; direct OAuth metadata on the origin works.
    const fetchImpl = routedFetch({
      "/.well-known/parachute.json": { ok: false, status: 404 },
      "http://localhost:1940/.well-known/oauth-authorization-server": { json: validMetadata },
    });
    const result = await probeVaultAtOrigin("http://localhost:1940", 500, fetchImpl);
    expect(result).toBe("http://localhost:1940");
  });

  it("falls back to direct OAuth for a vault-path URL behind a non-hub proxy", async () => {
    // User pastes `https://my-vault.example.com/vault/default` directly.
    // parachute.json at origin root doesn't exist (this host isn't running
    // the Parachute CLI portal); direct OAuth at the pasted URL works.
    const fetchImpl = routedFetch({
      "/.well-known/parachute.json": { ok: false, status: 404 },
      "/vault/default/.well-known/oauth-authorization-server": { json: validMetadata },
    });
    const result = await probeVaultAtOrigin(
      "https://my-vault.example.com/vault/default",
      500,
      fetchImpl,
    );
    expect(result).toBe("https://my-vault.example.com/vault/default");
  });

  it("returns null when neither parachute.json nor direct OAuth resolve", async () => {
    const fetchImpl = routedFetch({
      "/.well-known/parachute.json": { ok: false, status: 404 },
      "/.well-known/oauth-authorization-server": { ok: false, status: 404 },
    });
    expect(await probeVaultAtOrigin("https://h.example", 500, fetchImpl)).toBeNull();
  });

  it("falls through to direct OAuth when parachute.json points at a broken vault", async () => {
    // Registry was found but its vault entry fails OAuth metadata. Fall
    // through to direct discovery at the input origin — maybe the origin
    // itself is a valid vault and the registry is stale.
    const fetchImpl = routedFetch({
      "/.well-known/parachute.json": {
        json: { vault: { url: "https://h.example/vault/broken" } },
      },
      "/vault/broken/.well-known/oauth-authorization-server": { ok: false, status: 500 },
      "https://h.example/.well-known/oauth-authorization-server": { json: validMetadata },
    });
    expect(await probeVaultAtOrigin("https://h.example", 500, fetchImpl)).toBe("https://h.example");
  });

  it("returns null when parachute.json network-errors and no direct OAuth", async () => {
    const fetchImpl = routedFetch({
      "/.well-known/parachute.json": "network-error",
      "/.well-known/oauth-authorization-server": { ok: false, status: 404 },
    });
    expect(await probeVaultAtOrigin("https://h.example", 500, fetchImpl)).toBeNull();
  });
});

describe("shouldTryLocalHubFallback", () => {
  it("is true for localhost origins not already on the hub port", () => {
    expect(shouldTryLocalHubFallback("http://localhost:1942")).toBe(true);
    expect(shouldTryLocalHubFallback("http://127.0.0.1:1942")).toBe(true);
    expect(shouldTryLocalHubFallback("http://localhost:5173")).toBe(true);
  });

  it("is false when the page is already the hub origin (same-origin probe covered it)", () => {
    expect(shouldTryLocalHubFallback("http://127.0.0.1:1939")).toBe(false);
  });

  it("is false for remote origins where reaching loopback would be nonsensical", () => {
    expect(shouldTryLocalHubFallback("https://laptop.tail-foo.ts.net")).toBe(false);
    expect(shouldTryLocalHubFallback("https://notes.example.com")).toBe(false);
  });

  it("is false for malformed input", () => {
    expect(shouldTryLocalHubFallback("not a url")).toBe(false);
  });
});

describe("probeForVault", () => {
  it("falls back to the local hub when same-origin yields nothing (standalone-notes case)", async () => {
    // Notes is being served at :1942 by `parachute start notes`. The static
    // server doesn't serve parachute.json, so the same-origin probe finds
    // nothing. The hub on :1939 does — and that's what we want to find.
    const fetchImpl = routedFetch({
      "http://localhost:1942/.well-known/parachute.json": { ok: false, status: 404 },
      "http://localhost:1942/.well-known/oauth-authorization-server": { ok: false, status: 404 },
      "http://127.0.0.1:1939/.well-known/parachute.json": {
        json: { vault: { url: "http://127.0.0.1:1940/vault/default" } },
      },
      "http://127.0.0.1:1940/vault/default/.well-known/oauth-authorization-server": {
        json: validMetadata,
      },
    });
    const result = await probeForVault("http://localhost:1942", 500, fetchImpl);
    expect(result).toBe("http://127.0.0.1:1940/vault/default");
  });

  it("does not fall back when the same-origin probe already succeeded", async () => {
    // Notes is served by the hub portal at :1939/notes — same-origin probe
    // resolves the vault. The fallback should not even be attempted (no
    // wasted request to the same hub origin).
    const fetchImpl = routedFetch({
      "http://127.0.0.1:1939/.well-known/parachute.json": {
        json: { vault: { url: "http://127.0.0.1:1940/vault/default" } },
      },
      "http://127.0.0.1:1940/vault/default/.well-known/oauth-authorization-server": {
        json: validMetadata,
      },
    });
    const result = await probeForVault("http://127.0.0.1:1939", 500, fetchImpl);
    expect(result).toBe("http://127.0.0.1:1940/vault/default");
    // The same-origin probe makes parachute.json + oauth-metadata calls (2);
    // a fallback would add a third parachute.json call to 127.0.0.1:1939
    // which is the same URL — but we expect exactly the same-origin pair.
    const calls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(calls.filter((u) => u.includes("/.well-known/parachute.json"))).toHaveLength(1);
  });

  it("does not fall back for remote origins (no loopback reach across machines)", async () => {
    const fetchImpl = routedFetch({
      "https://notes.example.com/.well-known/parachute.json": { ok: false, status: 404 },
      "https://notes.example.com/.well-known/oauth-authorization-server": {
        ok: false,
        status: 404,
      },
    });
    const result = await probeForVault("https://notes.example.com", 500, fetchImpl);
    expect(result).toBeNull();
    const calls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("127.0.0.1:1939"))).toBe(false);
  });

  it("returns null when both same-origin and local hub probes fail", async () => {
    // Hub isn't running (or CORS blocks it); fall through to manual paste.
    const fetchImpl = routedFetch({
      "http://localhost:1942/.well-known/parachute.json": { ok: false, status: 404 },
      "http://localhost:1942/.well-known/oauth-authorization-server": { ok: false, status: 404 },
      "http://127.0.0.1:1939/.well-known/parachute.json": "network-error",
      "http://127.0.0.1:1939/.well-known/oauth-authorization-server": { ok: false, status: 404 },
    });
    const result = await probeForVault("http://localhost:1942", 500, fetchImpl);
    expect(result).toBeNull();
  });
});
