import { describe, expect, it, vi } from "vitest";
import {
  VaultAuthError,
  VaultClient,
  VaultConflictError,
  VaultNotFoundError,
  VaultTargetExistsError,
  VaultUploadError,
} from "./client";

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

class FakeXhrUpload {
  onprogress: ((e: ProgressEvent) => void) | null = null;
}

class FakeXhr {
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: Document | XMLHttpRequestBodyInit | null = null;
  status = 0;
  responseText = "";
  upload = new FakeXhrUpload();
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.body = body;
  }
  abort() {
    // Real XHRs fire onabort when abort() is called.
    this.fireAbort();
  }
  fireProgress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }
  resolve(status: number, body: string) {
    this.status = status;
    this.responseText = body;
    this.onload?.();
  }
  fireAbort() {
    this.onabort?.();
  }
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

  it("updateNote sends PATCH with JSON body to /api/notes/:id", async () => {
    const fetchImpl = mockFetch({
      json: {
        id: "Canon/Aaron",
        path: "Canon/Aaron",
        createdAt: "2026-04-16T00:00:00Z",
        updatedAt: "2026-04-18T12:00:00Z",
        content: "# hi",
        tags: ["canon"],
      },
    });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });

    await client.updateNote("Canon/Aaron", {
      content: "# new",
      tags: { add: ["draft"], remove: [] },
      if_updated_at: "2026-04-18T11:00:00Z",
    });

    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe("http://localhost:1940/api/notes/Canon%2FAaron");
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe("PATCH");
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer pvt_abc");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      content: "# new",
      tags: { add: ["draft"], remove: [] },
      if_updated_at: "2026-04-18T11:00:00Z",
    });
  });

  it("updateNote throws VaultConflictError on 409 with current/expected timestamps", async () => {
    const fetchImpl = mockFetch({
      ok: false,
      status: 409,
      json: {
        message: "Note was modified",
        current_updated_at: "2026-04-18T12:05:00Z",
        expected_updated_at: "2026-04-18T11:00:00Z",
      },
    });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });

    const err = await client
      .updateNote("a", { content: "x", if_updated_at: "2026-04-18T11:00:00Z" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(VaultConflictError);
    expect((err as VaultConflictError).currentUpdatedAt).toBe("2026-04-18T12:05:00Z");
    expect((err as VaultConflictError).expectedUpdatedAt).toBe("2026-04-18T11:00:00Z");
  });

  it("updateNote propagates 401 as VaultAuthError", async () => {
    const fetchImpl = mockFetch({ ok: false, status: 401 });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    await expect(client.updateNote("a", { content: "x" })).rejects.toBeInstanceOf(VaultAuthError);
  });

  it("createNote POSTs JSON to /api/notes and returns the created note", async () => {
    const fetchImpl = mockFetch({
      status: 201,
      json: {
        id: "new-id",
        path: "Projects/README",
        createdAt: "2026-04-18T12:00:00Z",
        content: "# hello",
        tags: ["docs"],
      },
    });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });

    const note = await client.createNote({
      content: "# hello",
      path: "Projects/README",
      tags: ["docs"],
      metadata: { summary: "A readme" },
    });

    expect(note.id).toBe("new-id");
    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe("http://localhost:1940/api/notes");
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      content: "# hello",
      path: "Projects/README",
      tags: ["docs"],
      metadata: { summary: "A readme" },
    });
  });

  it("createNote surfaces a generic failure so callers can hint at duplicate paths", async () => {
    const fetchImpl = mockFetch({
      ok: false,
      status: 500,
      text: '{"error":"Internal server error"}',
    });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    await expect(client.createNote({ content: "hi", path: "dup" })).rejects.toThrow(/500/);
  });

  it("deleteNote sends DELETE to /api/notes/:id and resolves void", async () => {
    const fetchImpl = mockFetch({ json: { deleted: true, id: "abc" } });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    await expect(client.deleteNote("abc-123")).resolves.toBeUndefined();
    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe("http://localhost:1940/api/notes/abc-123");
    expect((call?.[1] as RequestInit).method).toBe("DELETE");
  });

  it("deleteNote propagates 401 as VaultAuthError", async () => {
    const fetchImpl = mockFetch({ ok: false, status: 401 });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    await expect(client.deleteNote("abc")).rejects.toBeInstanceOf(VaultAuthError);
  });

  it("uploadStorageFile POSTs multipart to /api/storage/upload with Bearer + progress", async () => {
    const xhrs: FakeXhr[] = [];
    const factory = () => {
      const x = new FakeXhr();
      xhrs.push(x);
      return x as unknown as XMLHttpRequest;
    };
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl: vi.fn(),
      xhrFactory: factory,
    });

    const file = new File([new Uint8Array([1, 2, 3, 4])], "shot.png", { type: "image/png" });
    const progressSeen: number[] = [];
    const promise = client.uploadStorageFile(file, {
      onProgress: (p) => progressSeen.push(p.loaded),
    });

    const xhr = xhrs[0]!;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("http://localhost:1940/api/storage/upload");
    expect(xhr.headers.Authorization).toBe("Bearer pvt_abc");
    expect(xhr.body).toBeInstanceOf(FormData);
    expect((xhr.body as FormData).get("file")).toBeInstanceOf(File);

    xhr.fireProgress(2, 4);
    xhr.fireProgress(4, 4);
    xhr.resolve(
      201,
      JSON.stringify({ path: "2026-04-18/abc.png", size: 4, mimeType: "image/png" }),
    );

    const result = await promise;
    expect(result).toEqual({ path: "2026-04-18/abc.png", size: 4, mimeType: "image/png" });
    expect(progressSeen).toEqual([2, 4]);
  });

  it("uploadStorageFile throws VaultAuthError on 401", async () => {
    const xhrs: FakeXhr[] = [];
    const factory = () => {
      const x = new FakeXhr();
      xhrs.push(x);
      return x as unknown as XMLHttpRequest;
    };
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl: vi.fn(),
      xhrFactory: factory,
    });
    const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" });
    const p = client.uploadStorageFile(file);
    xhrs[0]!.resolve(401, '{"error":"unauthorized"}');
    await expect(p).rejects.toBeInstanceOf(VaultAuthError);
  });

  it("uploadStorageFile surfaces 413 with VaultUploadError carrying status", async () => {
    const xhrs: FakeXhr[] = [];
    const factory = () => {
      const x = new FakeXhr();
      xhrs.push(x);
      return x as unknown as XMLHttpRequest;
    };
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl: vi.fn(),
      xhrFactory: factory,
    });
    const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" });
    const p = client.uploadStorageFile(file);
    xhrs[0]!.resolve(413, '{"error":"File too large (200MB). Max: 100MB"}');
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(VaultUploadError);
    expect((err as VaultUploadError).status).toBe(413);
    expect((err as Error).message).toMatch(/too large/i);
  });

  it("uploadStorageFile aborts when signal is aborted", async () => {
    const xhrs: FakeXhr[] = [];
    const factory = () => {
      const x = new FakeXhr();
      xhrs.push(x);
      return x as unknown as XMLHttpRequest;
    };
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl: vi.fn(),
      xhrFactory: factory,
    });
    const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" });
    const controller = new AbortController();
    const p = client.uploadStorageFile(file, { signal: controller.signal });
    controller.abort();
    xhrs[0]!.fireAbort();
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe("AbortError");
  });

  it("linkAttachment POSTs JSON to /api/notes/:id/attachments and returns the attachment", async () => {
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

  it("linkAttachment propagates 401 as VaultAuthError", async () => {
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

  it("deleteAttachment sends DELETE to /api/notes/:id/attachments/:attId and resolves void", async () => {
    const fetchImpl = mockFetch({ status: 204 });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    await expect(client.deleteAttachment("note-a", "att-1")).resolves.toBeUndefined();
    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe("http://localhost:1940/api/notes/note-a/attachments/att-1");
    expect((call?.[1] as RequestInit).method).toBe("DELETE");
  });

  it("deleteAttachment throws VaultNotFoundError on 404 so callers can treat it as already-removed", async () => {
    const fetchImpl = mockFetch({ ok: false, status: 404 });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    await expect(client.deleteAttachment("note-a", "att-1")).rejects.toBeInstanceOf(
      VaultNotFoundError,
    );
  });

  it("deleteAttachment propagates 401 as VaultAuthError", async () => {
    const fetchImpl = mockFetch({ ok: false, status: 401 });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    await expect(client.deleteAttachment("note-a", "att-1")).rejects.toBeInstanceOf(VaultAuthError);
  });

  it("renameTag POSTs new_name to /api/tags/:name/rename and returns the count", async () => {
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

  it("renameTag encodes the source name so slashes and symbols survive", async () => {
    const fetchImpl = mockFetch({ json: { renamed: 0 } });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    await client.renameTag("a/b c", "d");
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://localhost:1940/api/tags/a%2Fb%20c/rename");
  });

  it("renameTag throws VaultTargetExistsError on 409 target_exists so callers can offer merge", async () => {
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

  it("renameTag propagates 404 as VaultNotFoundError", async () => {
    const fetchImpl = mockFetch({ ok: false, status: 404, json: { error: "not_found" } });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    await expect(client.renameTag("gone", "still-gone")).rejects.toBeInstanceOf(VaultNotFoundError);
  });

  it("renameTag propagates 401 as VaultAuthError", async () => {
    const fetchImpl = mockFetch({ ok: false, status: 401 });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    await expect(client.renameTag("a", "b")).rejects.toBeInstanceOf(VaultAuthError);
  });

  it("updateNote still throws VaultConflictError on a note-style 409 (not target_exists)", async () => {
    // Guard: the 409-body sniff for target_exists must not steal note-concurrency conflicts.
    const fetchImpl = mockFetch({
      ok: false,
      status: 409,
      json: {
        current_updated_at: "2026-04-18T12:05:00Z",
        expected_updated_at: "2026-04-18T11:00:00Z",
      },
    });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    await expect(
      client.updateNote("a", { content: "x", if_updated_at: "2026-04-18T11:00:00Z" }),
    ).rejects.toBeInstanceOf(VaultConflictError);
  });

  it("mergeTags POSTs sources + target to /api/tags/merge", async () => {
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

  it("mergeTags propagates 401 as VaultAuthError", async () => {
    const fetchImpl = mockFetch({ ok: false, status: 401 });
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_abc",
      fetchImpl,
    });
    await expect(client.mergeTags(["a"], "b")).rejects.toBeInstanceOf(VaultAuthError);
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

describe("VaultClient refresh-on-401", () => {
  // Sequenced fetch mock: lets a single test simulate "401 → refresh → 200".
  function sequencedFetch(responses: Array<{ ok?: boolean; status?: number; json?: unknown }>) {
    const queue = [...responses];
    return vi.fn<typeof fetch>(async () => {
      const next = queue.shift();
      if (!next) throw new Error("unexpected fetch call");
      return {
        ok: next.ok ?? true,
        status: next.status ?? 200,
        json: async () => next.json,
        text: async () => "",
      } as Response;
    });
  }

  it("retries once with the rotated token when onAuthError yields a fresh access token", async () => {
    const fetchImpl = sequencedFetch([
      { ok: false, status: 401 },
      { json: { name: "default", description: "" } },
    ]);
    const onAuthError = vi.fn(async () => "eyJ.new");
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "eyJ.stale",
      fetchImpl,
      onAuthError,
    });

    const info = await client.vaultInfo(false);
    expect(info.name).toBe("default");
    expect(onAuthError).toHaveBeenCalledTimes(1);

    // First call carried the stale token, second call carried the fresh one.
    const firstHeaders = new Headers((fetchImpl.mock.calls[0]?.[1] as RequestInit).headers);
    const secondHeaders = new Headers((fetchImpl.mock.calls[1]?.[1] as RequestInit).headers);
    expect(firstHeaders.get("Authorization")).toBe("Bearer eyJ.stale");
    expect(secondHeaders.get("Authorization")).toBe("Bearer eyJ.new");
  });

  it("throws VaultAuthError without retrying when onAuthError returns null", async () => {
    const fetchImpl = sequencedFetch([{ ok: false, status: 401 }]);
    const onAuthError = vi.fn(async () => null);
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "eyJ.stale",
      fetchImpl,
      onAuthError,
    });

    await expect(client.vaultInfo(false)).rejects.toBeInstanceOf(VaultAuthError);
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not loop on a second 401 — caps at one retry", async () => {
    // If the refresh-issued token is also rejected (e.g. vault hasn't picked up
    // the new key yet), we surface VaultAuthError instead of looping forever.
    const fetchImpl = sequencedFetch([
      { ok: false, status: 401 },
      { ok: false, status: 401 },
    ]);
    const onAuthError = vi.fn(async () => "eyJ.also-stale");
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "eyJ.stale",
      fetchImpl,
      onAuthError,
    });

    await expect(client.vaultInfo(false)).rejects.toBeInstanceOf(VaultAuthError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onAuthError).toHaveBeenCalledTimes(1);
  });

  it("calls onAuthRevoked when the post-refresh retry also returns 401", async () => {
    const fetchImpl = sequencedFetch([
      { ok: false, status: 401 },
      { ok: false, status: 401 },
    ]);
    const onAuthError = vi.fn(async () => "eyJ.also-stale");
    const onAuthRevoked = vi.fn();
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "eyJ.stale",
      fetchImpl,
      onAuthError,
      onAuthRevoked,
    });

    await expect(client.vaultInfo(false)).rejects.toBeInstanceOf(VaultAuthError);
    expect(onAuthRevoked).toHaveBeenCalledTimes(1);
    expect(onAuthRevoked).toHaveBeenCalledWith(401);
  });

  it("calls onAuthRevoked when there is no refresh callback wired", async () => {
    // Legacy `pvt_*` token path — VaultClient was constructed without
    // `onAuthError`, so the first 401 is definitive. Surface the halt so the
    // banner still appears.
    const fetchImpl = mockFetch({ ok: false, status: 401 });
    const onAuthRevoked = vi.fn();
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "pvt_legacy",
      fetchImpl,
      onAuthRevoked,
    });

    await expect(client.vaultInfo(false)).rejects.toBeInstanceOf(VaultAuthError);
    expect(onAuthRevoked).toHaveBeenCalledWith(401);
  });

  it("does NOT call onAuthRevoked when refresh succeeds (banner stays hidden on transient 401)", async () => {
    const fetchImpl = sequencedFetch([
      { ok: false, status: 401 },
      { json: { name: "default", description: "" } },
    ]);
    const onAuthError = vi.fn(async () => "eyJ.new");
    const onAuthRevoked = vi.fn();
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "eyJ.stale",
      fetchImpl,
      onAuthError,
      onAuthRevoked,
    });

    await client.vaultInfo(false);
    expect(onAuthRevoked).not.toHaveBeenCalled();
  });

  it("does NOT call onAuthRevoked when onAuthError returned null — refresh.ts owns that halt", async () => {
    // refresh.ts is responsible for marking halted with a specific reason
    // when it sees an HTTP error from the token endpoint. Avoid double-marking
    // (which would clobber the better message with a generic "(401)").
    const fetchImpl = sequencedFetch([{ ok: false, status: 401 }]);
    const onAuthError = vi.fn(async () => null);
    const onAuthRevoked = vi.fn();
    const client = new VaultClient({
      vaultUrl: "http://localhost:1940",
      accessToken: "eyJ.stale",
      fetchImpl,
      onAuthError,
      onAuthRevoked,
    });

    await expect(client.vaultInfo(false)).rejects.toBeInstanceOf(VaultAuthError);
    expect(onAuthRevoked).not.toHaveBeenCalled();
  });

  // Regression: the blob path (audio/image attachment loads) used to short-circuit
  // before `onAuthRevoked` was invented, so it never fired. A user whose
  // attachment loads start 401-ing after token revocation would get silent
  // VaultAuthError throws with no banner. These mirror the requestWithRetry
  // tests above against `fetchAttachmentBlob`.

  it("blob path: calls onAuthRevoked when the post-refresh retry also returns 401", async () => {
    const fetchImpl = sequencedFetch([
      { ok: false, status: 401 },
      { ok: false, status: 401 },
    ]);
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
    expect(onAuthRevoked).toHaveBeenCalledWith(401);
  });

  it("blob path: calls onAuthRevoked when there is no refresh callback wired", async () => {
    const fetchImpl = mockFetch({ ok: false, status: 401 });
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
    expect(onAuthRevoked).toHaveBeenCalledWith(401);
  });

  it("blob path: does NOT call onAuthRevoked when onAuthError returned null", async () => {
    const fetchImpl = sequencedFetch([{ ok: false, status: 401 }]);
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

describe("VaultClient default fetch binding", () => {
  // Regression for "TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation".
  // Browser's native `fetch` requires its `this` receiver to be the global (Window).
  // Storing `fetch` as a bare reference on an instance field loses that binding; at
  // call-time `this` becomes the VaultClient instance and the browser throws.
  // jsdom's fetch is permissive and doesn't enforce this invariant, so we install a
  // this-aware shim here that mimics the browser check. This test exists to catch
  // regressions in the default-path binding only — don't add one per endpoint.
  it("does not throw 'Illegal invocation' when no fetchImpl is provided", async () => {
    const shim = vi.fn(function (this: unknown, _url: string, _init?: RequestInit) {
      if (this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ name: "default", description: "" }),
        text: async () => "",
      } as Response);
    });
    vi.stubGlobal("fetch", shim);
    try {
      const client = new VaultClient({
        vaultUrl: "http://localhost:1940",
        accessToken: "pvt_abc",
      });
      await expect(client.vaultInfo(false)).resolves.toBeDefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
