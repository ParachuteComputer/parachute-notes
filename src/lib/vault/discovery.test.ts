import { describe, expect, it, vi } from "vitest";
import { discoverAuthServer, registerClient } from "./discovery";

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

describe("discoverAuthServer", () => {
  it("returns parsed metadata on success", async () => {
    const fetchImpl = mockFetch([{ json: validMetadata }]);
    const meta = await discoverAuthServer("http://localhost:1940", fetchImpl);
    expect(meta).toEqual(validMetadata);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:1940/.well-known/oauth-authorization-server",
      expect.any(Object),
    );
  });

  it("throws when the response is not ok", async () => {
    const fetchImpl = mockFetch([{ ok: false, status: 404 }]);
    await expect(discoverAuthServer("http://localhost:1940", fetchImpl)).rejects.toThrow(
      /discovery failed/i,
    );
  });

  it("throws when a required field is missing", async () => {
    const fetchImpl = mockFetch([{ json: { ...validMetadata, token_endpoint: "" } }]);
    await expect(discoverAuthServer("http://localhost:1940", fetchImpl)).rejects.toThrow(
      /token_endpoint/,
    );
  });

  it("throws when S256 PKCE is not advertised", async () => {
    const fetchImpl = mockFetch([
      { json: { ...validMetadata, code_challenge_methods_supported: ["plain"] } },
    ]);
    await expect(discoverAuthServer("http://localhost:1940", fetchImpl)).rejects.toThrow(/S256/);
  });
});

describe("registerClient", () => {
  it("POSTs redirect_uris and returns client_id", async () => {
    const fetchImpl = mockFetch([
      {
        json: {
          client_id: "abc-123",
          client_name: "Parachute Notes",
          redirect_uris: ["http://localhost/oauth/callback"],
        },
      },
    ]);
    const result = await registerClient(
      "http://localhost:1940/oauth/register",
      "http://localhost/oauth/callback",
      fetchImpl,
    );
    expect(result.client_id).toBe("abc-123");

    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe("http://localhost:1940/oauth/register");
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.redirect_uris).toEqual(["http://localhost/oauth/callback"]);
    expect(body.client_name).toBe("Parachute Notes");
  });

  it("throws on non-OK response", async () => {
    const fetchImpl = mockFetch([{ ok: false, status: 400, text: "bad metadata" }]);
    await expect(
      registerClient("http://localhost:1940/oauth/register", "http://localhost/cb", fetchImpl),
    ).rejects.toThrow(/registration failed.*bad metadata/i);
  });
});
