import { describe, expect, it, vi } from "vitest";
import { VaultClient } from "./client";
import { mergeTags, renameTag } from "./tag-mutations";
import type { Note } from "./types";

function fakeNote(id: string, tags: string[], path?: string): Note {
  return {
    id,
    path,
    tags,
    createdAt: "2026-04-18T00:00:00Z",
  };
}

function mockFetchSequence(responders: Array<(url: string, init: RequestInit) => Response>) {
  let i = 0;
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const res = responders[i]?.(url, init ?? {});
    i += 1;
    if (!res) throw new Error(`No fetch responder for call #${i}`);
    return res;
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function errorResponse(status: number, message: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({ message }),
    text: async () => message,
  } as Response;
}

describe("renameTag", () => {
  it("swaps tag on every matching note and deletes the source row", async () => {
    const notes = [fakeNote("n1", ["work"]), fakeNote("n2", ["work", "urgent"])];
    const updateCalls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = mockFetchSequence([
      // list notes with tag=work
      (url) => {
        expect(url).toContain("tag=work");
        return jsonResponse(notes);
      },
      // patch n1
      (url, init) => {
        updateCalls.push({ url, body: JSON.parse(init.body as string) });
        return jsonResponse({ ...notes[0], tags: ["projects"] });
      },
      // patch n2
      (url, init) => {
        updateCalls.push({ url, body: JSON.parse(init.body as string) });
        return jsonResponse({ ...notes[1], tags: ["projects", "urgent"] });
      },
      // delete /api/tags/work
      (url, init) => {
        expect(url).toContain("/api/tags/work");
        expect(init.method).toBe("DELETE");
        return jsonResponse(undefined, 204);
      },
    ]);
    const client = new VaultClient({
      vaultUrl: "http://v",
      accessToken: "t",
      fetchImpl,
    });

    const result = await renameTag(client, "work", "projects");
    expect(result).toEqual({ total: 2, succeeded: 2, failed: [], sourceDeleted: true });
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0]?.body).toEqual({
      tags: { add: ["projects"], remove: ["work"] },
    });
  });

  it("strips leading # and trims whitespace from both tag names", async () => {
    const fetchImpl = mockFetchSequence([
      (url) => {
        expect(url).toContain("tag=work");
        return jsonResponse([]);
      },
    ]);
    const client = new VaultClient({
      vaultUrl: "http://v",
      accessToken: "t",
      fetchImpl,
    });

    const result = await renameTag(client, "  #work  ", "#projects");
    expect(result.total).toBe(0);
    expect(result.sourceDeleted).toBe(false);
  });

  it("returns partial failure when a note PATCH errors and skips the tag delete", async () => {
    const notes = [fakeNote("n1", ["work"]), fakeNote("n2", ["work"], "x.md")];
    const fetchImpl = mockFetchSequence([
      () => jsonResponse(notes),
      () => jsonResponse({ ...notes[0], tags: ["projects"] }),
      () => errorResponse(500, "boom"),
    ]);
    const client = new VaultClient({
      vaultUrl: "http://v",
      accessToken: "t",
      fetchImpl,
    });

    const result = await renameTag(client, "work", "projects");
    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.noteId).toBe("n2");
    expect(result.failed[0]?.path).toBe("x.md");
    expect(result.sourceDeleted).toBe(false);
  });

  it("treats a 404 on the final tag delete as non-fatal", async () => {
    const notes = [fakeNote("n1", ["work"])];
    const fetchImpl = mockFetchSequence([
      () => jsonResponse(notes),
      () => jsonResponse({ ...notes[0], tags: ["projects"] }),
      () => errorResponse(404, "gone"),
    ]);
    const client = new VaultClient({
      vaultUrl: "http://v",
      accessToken: "t",
      fetchImpl,
    });

    const result = await renameTag(client, "work", "projects");
    expect(result.succeeded).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(result.sourceDeleted).toBe(false);
  });

  it("rejects when source and target are the same after normalization", async () => {
    const client = new VaultClient({
      vaultUrl: "http://v",
      accessToken: "t",
      fetchImpl: vi.fn(),
    });
    await expect(renameTag(client, "work", "#work")).rejects.toThrow(/same/);
  });

  it("rejects empty tag names", async () => {
    const client = new VaultClient({
      vaultUrl: "http://v",
      accessToken: "t",
      fetchImpl: vi.fn(),
    });
    await expect(renameTag(client, "   ", "new")).rejects.toThrow(/empty/i);
    await expect(renameTag(client, "old", " # ")).rejects.toThrow(/empty/i);
  });
});

describe("mergeTags", () => {
  it("runs rename for each source and returns a result per source", async () => {
    const fetchImpl = mockFetchSequence([
      () => jsonResponse([fakeNote("a", ["alpha"])]),
      () => jsonResponse({ id: "a", tags: ["greek"] }),
      () => jsonResponse(undefined, 204),
      () => jsonResponse([fakeNote("b", ["beta"]), fakeNote("c", ["beta"])]),
      () => jsonResponse({ id: "b", tags: ["greek"] }),
      () => jsonResponse({ id: "c", tags: ["greek"] }),
      () => jsonResponse(undefined, 204),
    ]);
    const client = new VaultClient({
      vaultUrl: "http://v",
      accessToken: "t",
      fetchImpl,
    });

    const results = await mergeTags(client, ["alpha", "beta"], "greek");
    expect(results).toHaveLength(2);
    expect(results[0]?.total).toBe(1);
    expect(results[1]?.total).toBe(2);
  });

  it("skips sources equal to the target after normalization", async () => {
    const fetchImpl = mockFetchSequence([
      () => jsonResponse([fakeNote("a", ["alpha"])]),
      () => jsonResponse({ id: "a", tags: ["target"] }),
      () => jsonResponse(undefined, 204),
    ]);
    const client = new VaultClient({
      vaultUrl: "http://v",
      accessToken: "t",
      fetchImpl,
    });

    const results = await mergeTags(client, ["alpha", "#target", "target"], "target");
    expect(results).toHaveLength(1);
  });

  it("rejects when no valid source tags remain", async () => {
    const client = new VaultClient({
      vaultUrl: "http://v",
      accessToken: "t",
      fetchImpl: vi.fn(),
    });
    await expect(mergeTags(client, ["target", "#target"], "target")).rejects.toThrow(/no source/i);
  });

  it("rejects an empty target", async () => {
    const client = new VaultClient({
      vaultUrl: "http://v",
      accessToken: "t",
      fetchImpl: vi.fn(),
    });
    await expect(mergeTags(client, ["a"], "  ")).rejects.toThrow(/empty/i);
  });
});
