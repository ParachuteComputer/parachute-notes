// Minimal wrapper around MediaRecorder. We pick the best supported mimeType
// up front, accumulate chunks, and hand back an ArrayBuffer on stop so the
// sync-queue blob store (which operates on ArrayBuffer + mimeType) can take
// it directly.

// Preferred first. Opus-in-webm is the default on Chrome and Firefox; Safari
// doesn't support webm, so we fall back to audio/mp4 (AAC). Ogg/Opus is a
// distant third that some older Firefox builds prefer.
export const PREFERRED_MIME_TYPES: readonly string[] = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export function pickMimeType(candidates: readonly string[] = PREFERRED_MIME_TYPES): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

export function extensionFor(mimeType: string): string {
  if (mimeType.startsWith("audio/webm")) return "webm";
  if (mimeType.startsWith("audio/mp4")) return "m4a";
  if (mimeType.startsWith("audio/ogg")) return "ogg";
  if (mimeType.startsWith("audio/wav")) return "wav";
  return "bin";
}

export interface RecordingResult {
  data: ArrayBuffer;
  mimeType: string;
  durationMs: number;
}

export type RecorderState = "idle" | "recording" | "paused" | "stopped";

export interface RecorderController {
  readonly state: RecorderState;
  readonly mimeType: string;
  start(): void;
  pause(): void;
  resume(): void;
  // Resolves with the final buffer once the underlying MediaRecorder flushes.
  // Stops microphone tracks as a side effect.
  stop(): Promise<RecordingResult>;
  // Discards the recording in progress without resolving stop(). Releases the
  // mic.
  cancel(): void;
}

export interface CreateRecorderOptions {
  stream: MediaStream;
  mimeType: string;
  // Injection points for tests; default to the browser globals.
  now?: () => number;
  MediaRecorderCtor?: typeof MediaRecorder;
}

export function createRecorder(opts: CreateRecorderOptions): RecorderController {
  const now = opts.now ?? (() => Date.now());
  const Ctor = opts.MediaRecorderCtor ?? MediaRecorder;
  const recorder = new Ctor(opts.stream, { mimeType: opts.mimeType });
  const chunks: Blob[] = [];
  let state: RecorderState = "idle";
  // We track accumulated recording time manually instead of trusting wall
  // clock alone, because the user can pause/resume.
  let startedAt = 0;
  let accumulatedMs = 0;

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const releaseTracks = () => {
    for (const track of opts.stream.getTracks()) track.stop();
  };

  return {
    get state() {
      return state;
    },
    get mimeType() {
      return opts.mimeType;
    },
    start(): void {
      if (state !== "idle") throw new Error(`Cannot start from ${state}`);
      recorder.start();
      startedAt = now();
      state = "recording";
    },
    pause(): void {
      if (state !== "recording") return;
      recorder.pause();
      accumulatedMs += now() - startedAt;
      state = "paused";
    },
    resume(): void {
      if (state !== "paused") return;
      recorder.resume();
      startedAt = now();
      state = "recording";
    },
    async stop(): Promise<RecordingResult> {
      if (state === "idle" || state === "stopped") {
        throw new Error(`Cannot stop from ${state}`);
      }
      if (state === "recording") {
        accumulatedMs += now() - startedAt;
      }
      const result = new Promise<RecordingResult>((resolve) => {
        recorder.onstop = async () => {
          // Concatenate chunks ourselves instead of `new Blob(chunks)`. In jsdom
          // the outer Blob stringifies nested Blobs; real browsers handle it
          // fine but we want the same code path both places.
          const data = await concatBlobs(chunks);
          resolve({ data, mimeType: opts.mimeType, durationMs: accumulatedMs });
        };
      });
      recorder.stop();
      state = "stopped";
      releaseTracks();
      return result;
    },
    cancel(): void {
      if (state === "recording" || state === "paused") {
        try {
          recorder.stop();
        } catch {
          // ignore; tracks still need releasing
        }
      }
      state = "stopped";
      chunks.length = 0;
      releaseTracks();
    },
  };
}

// Real browsers have Blob.arrayBuffer(); jsdom does not, and also stringifies
// Blobs passed to Response. FileReader is the lowest-common-denominator that
// works across modern browsers, jsdom, and Safari PWA webviews.
export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  const b = blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof b.arrayBuffer === "function") return b.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsArrayBuffer(blob);
  });
}

async function concatBlobs(chunks: readonly Blob[]): Promise<ArrayBuffer> {
  if (chunks.length === 0) return new ArrayBuffer(0);
  const parts = await Promise.all(chunks.map((c) => blobToArrayBuffer(c)));
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p), offset);
    offset += p.byteLength;
  }
  return out.buffer;
}

export interface PermissionError extends Error {
  kind: "permission-denied" | "no-device" | "unavailable";
}

export async function requestMic(): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    const err = new Error("Microphone is not available in this browser.") as PermissionError;
    err.kind = "unavailable";
    throw err;
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    const err = new Error(
      e instanceof Error ? e.message : "Microphone permission denied.",
    ) as PermissionError;
    const name = e instanceof DOMException ? e.name : "";
    err.kind =
      name === "NotFoundError" || name === "OverconstrainedError"
        ? "no-device"
        : "permission-denied";
    throw err;
  }
}

export function memoFilename(mimeType: string, at: Date = new Date()): string {
  const iso = at.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
  return `memo-${iso}.${extensionFor(mimeType)}`;
}

export function memoPath(at: Date = new Date()): string {
  // YYYY/MM-DD — lightweight daily grouping so vaults don't end up with a single
  // flat Memos/ folder. Adjust later if we want month folders instead.
  const yyyy = at.getFullYear();
  const mm = String(at.getMonth() + 1).padStart(2, "0");
  const dd = String(at.getDate()).padStart(2, "0");
  const hh = String(at.getHours()).padStart(2, "0");
  const mi = String(at.getMinutes()).padStart(2, "0");
  const ss = String(at.getSeconds()).padStart(2, "0");
  return `Memos/${yyyy}/${mm}-${dd}/${hh}-${mi}-${ss}`;
}

export function memoNoteContent(filename: string, at: Date = new Date()): string {
  return [
    "# 🎙️ Voice memo",
    "",
    `_Recorded ${at.toLocaleString()}._`,
    "",
    "_Transcript pending._",
    "",
    `![[${filename}]]`,
    "",
  ].join("\n");
}
