import { describe, expect, it, vi } from "vitest";
import { fetchHubVaults, hubOriginForVault } from "./hub-discovery";
import type { VaultRecord } from "./types";

function makeVault(partial: Partial<VaultRecord> & Pick<VaultRecord, "issuer">): VaultRecord {
  return {
    id: "v",
    url: "http://localhost:1939/vault/default",
    name: "default",
    clientId: "client",
    scope: "vault:read",
    addedAt: "2026-05-12T00:00:00.000Z",
    lastUsedAt: "2026-05-12T00:00:00.000Z",
    ...partial,
  };
}

function mockFetch(response: { ok?: boolean; status?: number; json?: unknown; text?: string }) {
  return vi.fn<typeof fetch>(async () => {
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.json,
      text: async () => response.text ?? "",
    } as Response;
  });
}

function mockFetchThrows(err: Error) {
  return vi.fn<typeof fetch>(async () => {
    throw err;
  });
}

describe("hubOriginForVault", () => {
  it("returns the origin of the issuer URL", () => {
    expect(hubOriginForVault(makeVault({ issuer: "http://localhost:1939" }))).toBe(
      "http://localhost:1939",
    );
  });

  it("strips path + query from a path-bearing issuer (standalone vault case)", () => {
    expect(hubOriginForVault(makeVault({ issuer: "https://hub.example.com/some/path?q=1" }))).toBe(
      "https://hub.example.com",
    );
  });

  it("returns null for an unparseable issuer", () => {
    expect(hubOriginForVault(makeVault({ issuer: "not a url" }))).toBe(null);
  });
});

describe("fetchHubVaults", () => {
  it("returns parsed vaults on a 200", async () => {
    const fetchImpl = mockFetch({
      json: {
        vaults: [
          { name: "default", url: "http://localhost:1939/vault/default", version: "0.1.0" },
          { name: "techne", url: "http://localhost:1939/vault/techne", version: "0.1.0" },
        ],
        services: [],
      },
    });
    const result = await fetchHubVaults("http://localhost:1939", fetchImpl);
    expect(result).toEqual([
      { name: "default", url: "http://localhost:1939/vault/default", version: "0.1.0" },
      { name: "techne", url: "http://localhost:1939/vault/techne", version: "0.1.0" },
    ]);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://localhost:1939/.well-known/parachute.json");
  });

  it("passes through optional managementUrl", async () => {
    const fetchImpl = mockFetch({
      json: {
        vaults: [
          {
            name: "default",
            url: "http://localhost:1939/vault/default",
            version: "0.1.0",
            managementUrl: "/vault/default/admin",
          },
        ],
      },
    });
    const result = await fetchHubVaults("http://localhost:1939", fetchImpl);
    expect(result?.[0]?.managementUrl).toBe("/vault/default/admin");
  });

  it("returns an empty array when the hub publishes no vaults", async () => {
    const fetchImpl = mockFetch({ json: { vaults: [], services: [] } });
    const result = await fetchHubVaults("http://localhost:1939", fetchImpl);
    expect(result).toEqual([]);
  });

  it("returns null on a non-2xx response", async () => {
    const fetchImpl = mockFetch({ ok: false, status: 404 });
    const result = await fetchHubVaults("http://localhost:1939", fetchImpl);
    expect(result).toBe(null);
  });

  it("returns null when fetch throws (network error)", async () => {
    const fetchImpl = mockFetchThrows(new Error("network down"));
    const result = await fetchHubVaults("http://localhost:1939", fetchImpl);
    expect(result).toBe(null);
  });

  it("returns null on malformed JSON", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("not JSON");
        },
      } as unknown as Response;
    });
    const result = await fetchHubVaults("http://localhost:1939", fetchImpl);
    expect(result).toBe(null);
  });

  it("returns null when the response body isn't an object", async () => {
    const fetchImpl = mockFetch({ json: "not an object" });
    const result = await fetchHubVaults("http://localhost:1939", fetchImpl);
    expect(result).toBe(null);
  });

  it("returns null when `vaults` is missing or not an array", async () => {
    const fetchImpl = mockFetch({ json: { services: [] } });
    const result = await fetchHubVaults("http://localhost:1939", fetchImpl);
    expect(result).toBe(null);
  });

  it("filters out malformed vault entries (missing name/url/version)", async () => {
    const fetchImpl = mockFetch({
      json: {
        vaults: [
          { name: "good", url: "http://localhost:1939/vault/good", version: "0.1.0" },
          { name: "missing-url", version: "0.1.0" },
          { url: "http://localhost:1939/vault/no-name", version: "0.1.0" },
          null,
          "string",
        ],
      },
    });
    const result = await fetchHubVaults("http://localhost:1939", fetchImpl);
    expect(result).toEqual([
      { name: "good", url: "http://localhost:1939/vault/good", version: "0.1.0" },
    ]);
  });

  it("strips trailing slash on the hub origin before composing the URL", async () => {
    const fetchImpl = mockFetch({ json: { vaults: [] } });
    await fetchHubVaults("http://localhost:1939/", fetchImpl);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://localhost:1939/.well-known/parachute.json");
  });
});
