import { describe, expect, it, vi } from "vitest";
import { VaultAuthError, VaultClient } from "./client";

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

describe("VaultClient", () => {
  it("sends Bearer token on every request and returns parsed JSON", async () => {
    const fetchImpl = mockFetch({
      json: {
        name: "default",
        description: "A vault",
        stats: { noteCount: 7, tagCount: 3, linkCount: 12 },
      },
    });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });

    const info = await client.vaultInfo();
    expect(info.stats?.noteCount).toBe(7);

    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe("http://localhost:1940/api/vault?include_stats=true");
    const init = call?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer pvt_abc");
  });

  it("throws VaultAuthError on 401 so TanStack Query can skip retries", async () => {
    const fetchImpl = mockFetch({ ok: false, status: 401 });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    await expect(client.vaultInfo()).rejects.toBeInstanceOf(VaultAuthError);
  });

  it("strips trailing slashes from the vault URL", async () => {
    const fetchImpl = mockFetch({ json: { name: "default", description: "" } });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940/",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    await client.vaultInfo(false);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://localhost:1940/api/vault");
  });

  it("queryNotes passes URLSearchParams to /api/notes and parses the array", async () => {
    const fetchImpl = mockFetch({
      json: [{ id: "a", createdAt: "2026-04-18T00:00:00Z", tags: ["daily"] }],
    });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });

    const params = new URLSearchParams({ search: "hello", sort: "desc", limit: "50" });
    const rows = await client.queryNotes(params);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tags).toEqual(["daily"]);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "http://localhost:1940/api/notes?search=hello&sort=desc&limit=50",
    );
  });

  it("queryNotes omits the querystring entirely when params are empty", async () => {
    const fetchImpl = mockFetch({ json: [] });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    await client.queryNotes(new URLSearchParams());
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://localhost:1940/api/notes");
  });

  it("getNote passes id, include_content, include_links, include_attachments", async () => {
    const fetchImpl = mockFetch({
      json: {
        id: "abc",
        path: "Canon/Aaron",
        createdAt: "2026-04-16T00:00:00Z",
        content: "# hi",
        tags: ["canon"],
        links: [],
        attachments: [],
      },
    });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });

    const note = await client.getNote("Canon/Aaron", {
      includeLinks: true,
      includeAttachments: true,
    });
    expect(note?.id).toBe("abc");

    const url = fetchImpl.mock.calls[0]?.[0] as string;
    expect(url).toContain("id=Canon%2FAaron");
    expect(url).toContain("include_content=true");
    expect(url).toContain("include_links=true");
    expect(url).toContain("include_attachments=true");
  });

  it("getNote unwraps an array response to a single note", async () => {
    const fetchImpl = mockFetch({
      json: [{ id: "a", createdAt: "2026-04-18T00:00:00Z" }],
    });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    const note = await client.getNote("a");
    expect(note?.id).toBe("a");
  });

  it("getNote returns null when the vault returns an empty array", async () => {
    const fetchImpl = mockFetch({ json: [] });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    const note = await client.getNote("missing");
    expect(note).toBeNull();
  });

  it("listTags hits /api/tags and returns the summary array", async () => {
    const fetchImpl = mockFetch({
      json: [
        { name: "daily", count: 42 },
        { name: "work", count: 7 },
      ],
    });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    const tags = await client.listTags();
    expect(tags).toHaveLength(2);
    expect(tags[0]).toEqual({ name: "daily", count: 42 });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://localhost:1940/api/tags");
  });
});
