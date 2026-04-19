// Minimal client for parachute-scribe's HTTP surface.
//
// Scribe exposes a Whisper-compatible API at POST /v1/audio/transcriptions —
// multipart upload of `file`, optional `cleanup` flag, response
// `{ text: string }` on 200 / `{ error: string }` on 4xx/5xx.
//
// All calls are classified into a small set of `ScribeError` kinds so the
// sync queue can decide between retry-with-backoff (unavailable) and
// stop-trying (auth/bad-request).
//
// CAVEAT: parachute-scribe currently sets no CORS headers. When called from
// a browser origin different from scribe's, preflight will fail. Users who
// hit this need to proxy scribe behind the same origin (or have scribe
// updated server-side).

import { ScribeError } from "./types";

export interface TranscribeOptions {
  audio: Blob | ArrayBuffer | Uint8Array;
  filename: string;
  mimeType: string;
  cleanup?: boolean;
  model?: string;
  token?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface TranscribeResult {
  text: string;
}

export async function transcribeAudio(
  baseUrl: string,
  opts: TranscribeOptions,
): Promise<TranscribeResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const form = new FormData();
  const blob = toBlob(opts.audio, opts.mimeType);
  form.append("file", blob, opts.filename);
  if (opts.cleanup !== undefined) form.append("cleanup", opts.cleanup ? "true" : "false");
  if (opts.model) form.append("model", opts.model);

  const url = joinUrl(baseUrl, "/v1/audio/transcriptions");

  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      body: form,
      headers,
      signal: opts.signal,
    });
  } catch (err) {
    // TypeError usually = network error; DOMException with AbortError = cancelled.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    const message = err instanceof Error ? err.message : "scribe network error";
    throw new ScribeError("unavailable", message);
  }

  if (res.status === 401 || res.status === 403) {
    throw new ScribeError("auth", await errorMessage(res, "Scribe rejected the token"), res.status);
  }
  if (res.status >= 500) {
    throw new ScribeError(
      "unavailable",
      await errorMessage(res, `Scribe server error (${res.status})`),
      res.status,
    );
  }
  if (!res.ok) {
    throw new ScribeError(
      "bad-request",
      await errorMessage(res, `Scribe rejected the request (${res.status})`),
      res.status,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid response";
    throw new ScribeError("parse", message);
  }
  if (!isTranscribeResult(body)) {
    throw new ScribeError("parse", "Scribe response missing `text` field");
  }
  return body;
}

export interface HealthOptions {
  token?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

// Returns true if scribe's /health endpoint responds 200 with {ok: true}.
// All other outcomes (including network errors) return false — callers can
// show a simple "reachable / not reachable" state.
export async function scribeHealth(baseUrl: string, opts: HealthOptions = {}): Promise<boolean> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = joinUrl(baseUrl, "/health");
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  try {
    const res = await fetchImpl(url, { headers, signal: opts.signal });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: unknown };
    return body?.ok === true;
  } catch {
    return false;
  }
}

function toBlob(audio: Blob | ArrayBuffer | Uint8Array, mimeType: string): Blob {
  if (audio instanceof Blob) return audio;
  const view = audio instanceof Uint8Array ? audio : new Uint8Array(audio);
  return new Blob([view], { type: mimeType });
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const trimmedPath = path.startsWith("/") ? path : `/${path}`;
  return trimmedBase + trimmedPath;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string") return body.error;
  } catch {
    // fall through
  }
  return fallback;
}

function isTranscribeResult(body: unknown): body is TranscribeResult {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { text?: unknown }).text === "string"
  );
}
