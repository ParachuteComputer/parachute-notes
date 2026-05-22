import { describe, expect, it, vi } from "vitest";
import { probeForIssuer, probeIssuerAtOrigin, shouldTryLocalHubFallback } from "./probe";

const validMetadata = {
  issuer: "http://localhost:1939",
  authorization_endpoint: "http://localhost:1939/oauth/authorize",
  token_endpoint: "http://localhost:1939/oauth/token",
  registration_endpoint: "http://localhost:1939/oauth/register",
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["S256"],
  grant_types_supported: ["authorization_code"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: ["vault:read", "vault:write"],
};

interface MockResponse {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
}

// URL-substring routed fetch mock. The probe fires only OAuth-metadata calls
// now (parachute.json indirection retired with hub-as-issuer), but we keep the
// route shape so adding a future probe target is a one-line change.
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

describe("probeIssuerAtOrigin", () => {
  it("resolves the candidate when OAuth metadata is served at the origin", async () => {
    const fetchImpl = routedFetch({
      "http://localhost:1939/.well-known/oauth-authorization-server": { json: validMetadata },
    });
    const result = await probeIssuerAtOrigin("http://localhost:1939", 500, fetchImpl);
    expect(result).toBe("http://localhost:1939");
  });

  it("resolves a vault-path issuer when the AS document lives under the path", async () => {
    // Standalone vault: user pastes `https://my-vault.example.com/vault/default`.
    // The AS metadata sits under `/vault/default/.well-known/...` per RFC 8414.
    const fetchImpl = routedFetch({
      "/vault/default/.well-known/oauth-authorization-server": {
        json: { ...validMetadata, issuer: "https://my-vault.example.com/vault/default" },
      },
    });
    const result = await probeIssuerAtOrigin(
      "https://my-vault.example.com/vault/default",
      500,
      fetchImpl,
    );
    expect(result).toBe("https://my-vault.example.com/vault/default");
  });

  it("returns null when discovery fails", async () => {
    const fetchImpl = routedFetch({
      "/.well-known/oauth-authorization-server": { ok: false, status: 404 },
    });
    expect(await probeIssuerAtOrigin("https://h.example", 500, fetchImpl)).toBeNull();
  });

  it("returns null when discovery network-errors", async () => {
    const fetchImpl = routedFetch({
      "/.well-known/oauth-authorization-server": "network-error",
    });
    expect(await probeIssuerAtOrigin("https://h.example", 500, fetchImpl)).toBeNull();
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

describe("probeForIssuer", () => {
  it("falls back to the local hub when same-origin yields nothing (standalone-notes case)", async () => {
    // Notes is being served at :1942 by `parachute start notes`. The static
    // server doesn't serve OAuth metadata; the hub on :1939 does — and that's
    // what we want to find.
    const fetchImpl = routedFetch({
      "http://localhost:1942/.well-known/oauth-authorization-server": { ok: false, status: 404 },
      "http://127.0.0.1:1939/.well-known/oauth-authorization-server": { json: validMetadata },
    });
    const result = await probeForIssuer("http://localhost:1942", 500, fetchImpl);
    expect(result).toBe("http://127.0.0.1:1939");
  });

  it("does not fall back when the same-origin probe already succeeded", async () => {
    // Notes is served by the hub portal at :1939/notes — same-origin probe
    // resolves the issuer. The fallback should not even be attempted.
    const fetchImpl = routedFetch({
      "http://127.0.0.1:1939/.well-known/oauth-authorization-server": { json: validMetadata },
    });
    const result = await probeForIssuer("http://127.0.0.1:1939", 500, fetchImpl);
    expect(result).toBe("http://127.0.0.1:1939");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not fall back for remote origins (no loopback reach across machines)", async () => {
    const fetchImpl = routedFetch({
      "https://notes.example.com/.well-known/oauth-authorization-server": {
        ok: false,
        status: 404,
      },
    });
    const result = await probeForIssuer("https://notes.example.com", 500, fetchImpl);
    expect(result).toBeNull();
    const calls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("127.0.0.1:1939"))).toBe(false);
  });

  it("returns null when both same-origin and local hub probes fail", async () => {
    const fetchImpl = routedFetch({
      "http://localhost:1942/.well-known/oauth-authorization-server": { ok: false, status: 404 },
      "http://127.0.0.1:1939/.well-known/oauth-authorization-server": "network-error",
    });
    const result = await probeForIssuer("http://localhost:1942", 500, fetchImpl);
    expect(result).toBeNull();
  });
});
