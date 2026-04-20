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

// Fetch mock that routes by URL substring instead of a fixed queue — the new
// probe makes two kinds of calls (parachute.json + oauth metadata) and a
// flat queue is brittle if the order changes.
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
  it("resolves at the hub origin directly via OAuth metadata (Phase 0)", async () => {
    // Hub origin advertises itself as issuer; the parachute.json registry
    // isn't needed at all. Direct OAuth discovery wins without any registry
    // fetch being required.
    const hubMetadata = { ...validMetadata, issuer: "https://hub.example" };
    const fetchImpl = routedFetch({
      "/.well-known/oauth-authorization-server": { json: hubMetadata },
    });
    const result = await probeVaultAtOrigin("https://hub.example", 500, fetchImpl);
    expect(result).toBe("https://hub.example");
  });

  it("resolves a directly-pasted vault URL via OAuth metadata", async () => {
    // Standalone vault case: user pastes the full vault URL. Direct probe
    // (first) succeeds; no registry consulted.
    const fetchImpl = routedFetch({
      "/vault/default/.well-known/oauth-authorization-server": { json: validMetadata },
    });
    const result = await probeVaultAtOrigin("https://h.example/vault/default", 500, fetchImpl);
    expect(result).toBe("https://h.example/vault/default");
  });

  it("falls back to parachute.json when direct OAuth discovery fails", async () => {
    // User pasted a bare origin that doesn't serve OAuth metadata itself but
    // does publish a registry pointing at a real vault URL.
    const fetchImpl = routedFetch({
      // Direct probe on the origin fails.
      "https://h.example/.well-known/oauth-authorization-server": { ok: false, status: 404 },
      "/.well-known/parachute.json": {
        json: { vault: { url: "https://h.example/vault/default" } },
      },
      "/vault/default/.well-known/oauth-authorization-server": { json: validMetadata },
    });
    const result = await probeVaultAtOrigin("https://h.example", 500, fetchImpl);
    expect(result).toBe("https://h.example/vault/default");
  });

  it("prefers the entry named `default` from a multi-vault parachute.json fallback", async () => {
    const fetchImpl = routedFetch({
      "https://h.example/.well-known/oauth-authorization-server": { ok: false, status: 404 },
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

  it("returns null when neither direct OAuth nor parachute.json resolve", async () => {
    const fetchImpl = routedFetch({
      "/.well-known/oauth-authorization-server": { ok: false, status: 404 },
      "/.well-known/parachute.json": { ok: false, status: 404 },
    });
    expect(await probeVaultAtOrigin("https://h.example", 500, fetchImpl)).toBeNull();
  });

  it("returns null on network error during direct probe with no registry", async () => {
    const fetchImpl = routedFetch({
      "/.well-known/oauth-authorization-server": "network-error",
      "/.well-known/parachute.json": { ok: false, status: 404 },
    });
    expect(await probeVaultAtOrigin("https://h.example", 500, fetchImpl)).toBeNull();
  });

  it("returns null when parachute.json is found but its vault fails OAuth metadata", async () => {
    const fetchImpl = routedFetch({
      // Direct probe on the origin fails, and the registry-pointed vault
      // also fails OAuth metadata.
      "https://h.example/.well-known/oauth-authorization-server": { ok: false, status: 404 },
      "/.well-known/parachute.json": {
        json: { vault: { url: "https://h.example/vault/broken" } },
      },
      "/vault/broken/.well-known/oauth-authorization-server": { ok: false, status: 500 },
    });
    expect(await probeVaultAtOrigin("https://h.example", 500, fetchImpl)).toBeNull();
  });
});
