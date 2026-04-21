import { describe, expect, it, vi } from "vitest";
import { probeVaultAtOrigin } from "./probe";

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
