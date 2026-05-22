import { describe, expect, it, vi } from "vitest";
import { VaultAuthError, VaultClient, VaultNotFoundError, VaultTargetExistsError } from "./client";

function mockFetch(response: { ok?: boolean; status?: number; json?: unknown; text?: string }) {
  return vi.fn<typeof fetch>(async () => {
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.json,
      text: async () => response.text ?? "",
      blob: async () => new Blob([response.text ?? ""]),
      headers: new Headers(),
    } as Response;
  });
}

// Tests in this file cover ONLY the Notes-specific surface on
// `VaultClient` — the methods Notes adds on top of
// `@openparachute/app-client`'s base class:
//
//   - `linkAttachment` (Notes-only alias of base `addAttachment`)
//   - `renameTag` / `mergeTags` / `deleteTag` (tag-curation)
//   - `listTagsWithSchema` (schema-audit runner)
//   - `fetchAttachmentBlob` (audio/image render path)
//
// The shared request loop (auto-refresh on 401/403, reachability
// signals, structured error classification) is covered by app-client's
// own test suite (`packages/app-client/src/__tests__/vault-client.test.ts`
// in parachute-app). Re-asserting those behaviors here would be
// redundant and slow.

describe("VaultClient (Notes subclass) — Notes-only endpoints", () => {
  describe("linkAttachment", () => {
    it("POSTs JSON to /api/notes/:id/attachments and returns the attachment", async () => {
      const fetchImpl = mockFetch({
        status: 201,
        json: {
          id: "att-1",
          noteId: "note-a",
          path: "2026-04-18/abc.png",
          mimeType: "image/png",
          createdAt: "2026-04-18T12:00:00Z",
        },
      });
      const client = new VaultClient({
        vaultUrl: "http://localhost:1940",
        accessToken: "pvt_abc",
        fetchImpl,
      });
      const att = await client.linkAttachment("note-a", {
        path: "2026-04-18/abc.png",
        mimeType: "image/png",
      });
      expect(att.id).toBe("att-1");
      const call = fetchImpl.mock.calls[0];
      expect(call?.[0]).toBe("http://localhost:1940/api/notes/note-a/attachments");
      const init = call?.[1] as RequestInit;
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
      expect(JSON.parse(init.body as string)).toEqual({
        path: "2026-04-18/abc.png",
        mimeType: "image/png",
      });
    });

    it("propagates 401 as VaultAuthError", async () => {
      const fetchImpl = mockFetch({ ok: false, status: 401 });
      const client = new VaultClient({
        vaultUrl: "http://localhost:1940",
        accessToken: "pvt_abc",
        fetchImpl,
      });
      await expect(
        client.linkAttachment("note-a", { path: "x", mimeType: "image/png" }),
      ).rejects.toBeInstanceOf(VaultAuthError);
    });
  });

  describe("renameTag", () => {
    it("POSTs new_name to /api/tags/:name/rename and returns the count", async () => {
      const fetchImpl = mockFetch({ json: { renamed: 3 } });
      const client = new VaultClient({
        vaultUrl: "http://localhost:1940",
        accessToken: "pvt_abc",
        fetchImpl,
      });
      await expect(client.renameTag("work", "projects")).resolves.toEqual({ renamed: 3 });
      const call = fetchImpl.mock.calls[0];
      expect(call?.[0]).toBe("http://localhost:1940/api/tags/work/rename");
      const init = call?.[1] as RequestInit;
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
      expect(JSON.parse(init.body as string)).toEqual({ new_name: "projects" });
    });

    it("encodes the source name so slashes and symbols survive", async () => {
      const fetchImpl = mockFetch({ json: { renamed: 0 } });
      const client = new VaultClient({
        vaultUrl: "http://localhost:1940",
        accessToken: "pvt_abc",
        fetchImpl,
      });
      await client.renameTag("a/b c", "d");
      expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://localhost:1940/api/tags/a%2Fb%20c/rename");
    });

    it("throws VaultTargetExistsError on 409 target_exists so callers can offer merge", async () => {
      const fetchImpl = mockFetch({
        ok: false,
        status: 409,
        json: { error: "target_exists", target: "projects", message: "already exists" },
      });
      const client = new VaultClient({
        vaultUrl: "http://localhost:1940",
        accessToken: "pvt_abc",
        fetchImpl,
      });
      const err = await client.renameTag("work", "projects").catch((e) => e);
      expect(err).toBeInstanceOf(VaultTargetExistsError);
      expect((err as VaultTargetExistsError).target).toBe("projects");
    });

    it("propagates 404 as VaultNotFoundError", async () => {
      const fetchImpl = mockFetch({ ok: false, status: 404, json: { error: "not_found" } });
      const client = new VaultClient({
        vaultUrl: "http://localhost:1940",
        accessToken: "pvt_abc",
        fetchImpl,
      });
      await expect(client.renameTag("gone", "still-gone")).rejects.toBeInstanceOf(
        VaultNotFoundError,
      );
    });
  });

  describe("mergeTags", () => {
    it("POSTs sources + target to /api/tags/merge", async () => {
      const fetchImpl = mockFetch({
        json: { merged: { alpha: 3, beta: 2 }, target: "projects" },
      });
      const client = new VaultClient({
        vaultUrl: "http://localhost:1940",
        accessToken: "pvt_abc",
        fetchImpl,
      });
      const res = await client.mergeTags(["alpha", "beta"], "projects");
      expect(res.target).toBe("projects");
      expect(res.merged).toEqual({ alpha: 3, beta: 2 });
      const call = fetchImpl.mock.calls[0];
      expect(call?.[0]).toBe("http://localhost:1940/api/tags/merge");
      const init = call?.[1] as RequestInit;
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        sources: ["alpha", "beta"],
        target: "projects",
      });
    });
  });

  describe("deleteTag", () => {
    it("sends DELETE to /api/tags/:name", async () => {
      const fetchImpl = mockFetch({ status: 204 });
      const client = new VaultClient({
        vaultUrl: "http://localhost:1940",
        accessToken: "pvt_abc",
        fetchImpl,
      });
      await expect(client.deleteTag("work")).resolves.toBeUndefined();
      const call = fetchImpl.mock.calls[0];
      expect(call?.[0]).toBe("http://localhost:1940/api/tags/work");
      expect((call?.[1] as RequestInit).method).toBe("DELETE");
    });
  });

  describe("listTagsWithSchema", () => {
    it("GETs /api/tags?include_schema=true and returns the rows", async () => {
      const fetchImpl = mockFetch({
        json: [
          {
            name: "voice",
            count: 4,
            description: "Voice captures",
            parent_names: ["capture"],
          },
        ],
      });
      const client = new VaultClient({
        vaultUrl: "http://localhost:1940",
        accessToken: "pvt_abc",
        fetchImpl,
      });
      const rows = await client.listTagsWithSchema();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe("voice");
      expect(fetchImpl.mock.calls[0]?.[0]).toBe(
        "http://localhost:1940/api/tags?include_schema=true",
      );
    });
  });
});

describe("VaultClient (Notes subclass) — fetchAttachmentBlob", () => {
  function mockBlobFetch(responses: Array<{ status: number; body?: string }>) {
    const queue = [...responses];
    return vi.fn<typeof fetch>(async () => {
      const next = queue.shift();
      if (!next) throw new Error("unexpected fetch call");
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        blob: async () => new Blob([next.body ?? ""]),
        text: async () => next.body ?? "",
        json: async () => ({}),
        headers: new Headers(),
      } as Response;
    });
  }

  it("GETs the absolute target with Bearer auth and returns a Blob", async () => {
    const fetchImpl = mockBlobFetch([{ status: 200, body: "audio-bytes" }]);
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    const blob = await client.fetchAttachmentBlob("/api/storage/foo.mp3");
    expect(blob).toBeInstanceOf(Blob);
    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe("http://localhost:1940/api/storage/foo.mp3");
    const headers = (call?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer pvt_abc");
  });

  it("retries once with the rotated token on 401 + onAuthError", async () => {
    const fetchImpl = mockBlobFetch([{ status: 401 }, { status: 200, body: "bytes" }]);
    const onAuthError = vi.fn(async () => "eyJ.new");
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "eyJ.stale",
      fetchImpl,
      onAuthError,
    });
    await client.fetchAttachmentBlob("/api/storage/foo.mp3");
    expect(onAuthError).toHaveBeenCalledTimes(1);
    const headers0 = (fetchImpl.mock.calls[0]?.[1] as RequestInit).headers as Record<
      string,
      string
    >;
    const headers1 = (fetchImpl.mock.calls[1]?.[1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers0.Authorization).toBe("Bearer eyJ.stale");
    expect(headers1.Authorization).toBe("Bearer eyJ.new");
  });

  it("calls onAuthRevoked when the post-refresh retry also returns 401", async () => {
    const fetchImpl = mockBlobFetch([{ status: 401 }, { status: 401 }]);
    const onAuthError = vi.fn(async () => "eyJ.also-stale");
    const onAuthRevoked = vi.fn();
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "eyJ.stale",
      fetchImpl,
      onAuthError,
      onAuthRevoked,
    });
    await expect(client.fetchAttachmentBlob("/api/storage/foo.mp3")).rejects.toBeInstanceOf(
      VaultAuthError,
    );
    expect(onAuthRevoked).toHaveBeenCalledTimes(1);
    expect(onAuthRevoked).toHaveBeenCalledWith(401, {
      errorType: undefined,
      message: undefined,
    });
  });

  it("calls onAuthRevoked when there is no refresh callback wired", async () => {
    const fetchImpl = mockBlobFetch([{ status: 401 }]);
    const onAuthRevoked = vi.fn();
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_legacy",
      fetchImpl,
      onAuthRevoked,
    });
    await expect(client.fetchAttachmentBlob("/api/storage/foo.mp3")).rejects.toBeInstanceOf(
      VaultAuthError,
    );
    expect(onAuthRevoked).toHaveBeenCalledWith(401, {
      errorType: undefined,
      message: undefined,
    });
  });

  it("forwards parsed error_type + message to onAuthRevoked when the body carries enhanced-error detail", async () => {
    const fetchImpl = mockBlobFetch([
      {
        status: 403,
        body: JSON.stringify({
          error_type: "token_revoked",
          message: "session ended elsewhere",
        }),
      },
    ]);
    const onAuthRevoked = vi.fn();
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_legacy",
      fetchImpl,
      onAuthRevoked,
    });
    await expect(client.fetchAttachmentBlob("/api/storage/foo.mp3")).rejects.toBeInstanceOf(
      VaultAuthError,
    );
    expect(onAuthRevoked).toHaveBeenCalledWith(403, {
      errorType: "token_revoked",
      message: "session ended elsewhere",
    });
  });

  it("does NOT call onAuthRevoked when onAuthError returned null — refresh.ts owns that halt", async () => {
    const fetchImpl = mockBlobFetch([{ status: 401 }]);
    const onAuthError = vi.fn(async () => null);
    const onAuthRevoked = vi.fn();
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "eyJ.stale",
      fetchImpl,
      onAuthError,
      onAuthRevoked,
    });
    await expect(client.fetchAttachmentBlob("/api/storage/foo.mp3")).rejects.toBeInstanceOf(
      VaultAuthError,
    );
    expect(onAuthRevoked).not.toHaveBeenCalled();
  });
});
