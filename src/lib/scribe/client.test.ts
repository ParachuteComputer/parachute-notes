import { describe, expect, it, vi } from "vitest";
import { scribeHealth, transcribeAudio } from "./client";
import { ScribeError } from "./types";

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn(impl) as unknown as typeof fetch;
}

describe("transcribeAudio", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);

  it("POSTs multipart/form-data with the audio and returns text", async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = mockFetch(async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ text: "hello world" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await transcribeAudio("http://scribe.local:3200", {
      audio: bytes,
      filename: "memo.webm",
      mimeType: "audio/webm",
      fetchImpl,
    });
    expect(result.text).toBe("hello world");
    expect(captured!.url).toBe("http://scribe.local:3200/v1/audio/transcriptions");
    expect(captured!.init?.method).toBe("POST");
    const form = captured!.init?.body as FormData;
    expect(form.get("file")).toBeInstanceOf(Blob);
    const file = form.get("file") as Blob;
    expect(file.size).toBe(4);
  });

  it("appends cleanup=true when requested", async () => {
    let form: FormData | null = null;
    const fetchImpl = mockFetch(async (_url, init) => {
      form = init?.body as FormData;
      return new Response(JSON.stringify({ text: "cleaned up" }), { status: 200 });
    });
    await transcribeAudio("http://scribe.local", {
      audio: bytes,
      filename: "memo.webm",
      mimeType: "audio/webm",
      cleanup: true,
      fetchImpl,
    });
    expect(form!.get("cleanup")).toBe("true");
  });

  it("appends cleanup=false explicitly when disabled", async () => {
    let form: FormData | null = null;
    const fetchImpl = mockFetch(async (_url, init) => {
      form = init?.body as FormData;
      return new Response(JSON.stringify({ text: "raw" }), { status: 200 });
    });
    await transcribeAudio("http://scribe.local", {
      audio: bytes,
      filename: "memo.webm",
      mimeType: "audio/webm",
      cleanup: false,
      fetchImpl,
    });
    expect(form!.get("cleanup")).toBe("false");
  });

  it("sends Authorization header when a token is provided", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = mockFetch(async (_url, init) => {
      captured = init;
      return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
    });
    await transcribeAudio("http://scribe.local", {
      audio: bytes,
      filename: "m.webm",
      mimeType: "audio/webm",
      token: "sk-secret",
      fetchImpl,
    });
    const headers = captured?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-secret");
  });

  it("maps 401 to ScribeError with kind=auth", async () => {
    const fetchImpl = mockFetch(
      async () =>
        new Response(JSON.stringify({ error: "no token" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      transcribeAudio("http://scribe.local", {
        audio: bytes,
        filename: "m.webm",
        mimeType: "audio/webm",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ kind: "auth", status: 401 });
  });

  it("maps 503 to ScribeError with kind=unavailable", async () => {
    const fetchImpl = mockFetch(
      async () => new Response(JSON.stringify({ error: "overloaded" }), { status: 503 }),
    );
    await expect(
      transcribeAudio("http://scribe.local", {
        audio: bytes,
        filename: "m.webm",
        mimeType: "audio/webm",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ kind: "unavailable", status: 503 });
  });

  it("maps network failure to ScribeError with kind=unavailable", async () => {
    const fetchImpl = mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      transcribeAudio("http://scribe.local", {
        audio: bytes,
        filename: "m.webm",
        mimeType: "audio/webm",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("maps 400 to ScribeError with kind=bad-request", async () => {
    const fetchImpl = mockFetch(
      async () => new Response(JSON.stringify({ error: "missing file" }), { status: 400 }),
    );
    await expect(
      transcribeAudio("http://scribe.local", {
        audio: bytes,
        filename: "m.webm",
        mimeType: "audio/webm",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ kind: "bad-request", status: 400 });
  });

  it("maps malformed response body to ScribeError with kind=parse", async () => {
    const fetchImpl = mockFetch(
      async () =>
        new Response(JSON.stringify({ not_text: "oops" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      transcribeAudio("http://scribe.local", {
        audio: bytes,
        filename: "m.webm",
        mimeType: "audio/webm",
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(ScribeError);
  });

  it("rethrows AbortError on cancellation", async () => {
    const fetchImpl = mockFetch(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(
      transcribeAudio("http://scribe.local", {
        audio: bytes,
        filename: "m.webm",
        mimeType: "audio/webm",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("joins baseUrl with trailing slash correctly", async () => {
    let captured: string | null = null;
    const fetchImpl = mockFetch(async (url) => {
      captured = url;
      return new Response(JSON.stringify({ text: "x" }), { status: 200 });
    });
    await transcribeAudio("http://scribe.local/", {
      audio: bytes,
      filename: "m.webm",
      mimeType: "audio/webm",
      fetchImpl,
    });
    expect(captured).toBe("http://scribe.local/v1/audio/transcriptions");
  });
});

describe("scribeHealth", () => {
  it("returns true when /health responds {ok:true}", async () => {
    const fetchImpl = mockFetch(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    expect(await scribeHealth("http://scribe.local", { fetchImpl })).toBe(true);
  });

  it("returns false when /health responds non-200", async () => {
    const fetchImpl = mockFetch(async () => new Response("nope", { status: 500 }));
    expect(await scribeHealth("http://scribe.local", { fetchImpl })).toBe(false);
  });

  it("returns false on network error", async () => {
    const fetchImpl = mockFetch(async () => {
      throw new TypeError("offline");
    });
    expect(await scribeHealth("http://scribe.local", { fetchImpl })).toBe(false);
  });

  it("includes bearer token when provided", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = mockFetch(async (_url, init) => {
      captured = init;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await scribeHealth("http://scribe.local", { token: "abc", fetchImpl });
    const headers = captured?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer abc");
  });
});
