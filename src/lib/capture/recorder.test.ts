import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PREFERRED_MIME_TYPES,
  createRecorder,
  extensionFor,
  memoFilename,
  memoNoteContent,
  memoPath,
  pickMimeType,
  requestMic,
} from "./recorder";

// Minimal stand-in for MediaRecorder so we can exercise the wrapper in jsdom.
// We model just the surface the wrapper uses: ondataavailable / onstop events,
// start / pause / resume / stop methods.
class FakeMediaRecorder {
  static supported = new Set<string>();
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  stream: MediaStream;
  mimeType: string;
  state: "inactive" | "recording" | "paused" = "inactive";

  constructor(stream: MediaStream, opts: { mimeType: string }) {
    this.stream = stream;
    this.mimeType = opts.mimeType;
  }
  static isTypeSupported(t: string): boolean {
    return FakeMediaRecorder.supported.has(t);
  }
  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3, 4])]) });
    this.onstop?.();
  }
}

function fakeStream(): MediaStream {
  const tracks: MediaStreamTrack[] = [];
  return {
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

describe("pickMimeType", () => {
  it("returns the first supported candidate", () => {
    FakeMediaRecorder.supported = new Set(["audio/mp4", "audio/ogg;codecs=opus"]);
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder as unknown as typeof MediaRecorder);
    try {
      expect(pickMimeType(PREFERRED_MIME_TYPES)).toBe("audio/mp4");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns null when MediaRecorder is missing", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    try {
      expect(pickMimeType(PREFERRED_MIME_TYPES)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns null when no candidate matches", () => {
    FakeMediaRecorder.supported = new Set();
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder as unknown as typeof MediaRecorder);
    try {
      expect(pickMimeType(PREFERRED_MIME_TYPES)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("extensionFor", () => {
  it("maps common audio mime types", () => {
    expect(extensionFor("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionFor("audio/mp4")).toBe("m4a");
    expect(extensionFor("audio/ogg;codecs=opus")).toBe("ogg");
    expect(extensionFor("audio/wav")).toBe("wav");
    expect(extensionFor("application/octet-stream")).toBe("bin");
  });
});

describe("createRecorder", () => {
  beforeEach(() => {
    FakeMediaRecorder.supported = new Set(["audio/webm;codecs=opus"]);
  });

  it("records, stops, and returns an ArrayBuffer + duration", async () => {
    let t = 1_000;
    const rec = createRecorder({
      stream: fakeStream(),
      mimeType: "audio/webm;codecs=opus",
      now: () => t,
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
    });
    rec.start();
    t += 3_500;
    const result = await rec.stop();
    expect(result.mimeType).toBe("audio/webm;codecs=opus");
    expect(result.durationMs).toBe(3_500);
    expect(Array.from(new Uint8Array(result.data))).toEqual([1, 2, 3, 4]);
  });

  it("pause + resume excludes paused time from duration", async () => {
    let t = 0;
    const rec = createRecorder({
      stream: fakeStream(),
      mimeType: "audio/webm;codecs=opus",
      now: () => t,
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
    });
    rec.start();
    t = 2_000;
    rec.pause();
    // 5 seconds of "pause" that should not count.
    t = 7_000;
    rec.resume();
    t = 9_000;
    const result = await rec.stop();
    expect(result.durationMs).toBe(4_000);
  });

  it("cancel stops tracks without resolving", () => {
    const trackStop = vi.fn();
    const stream = {
      getTracks: () => [{ stop: trackStop } as unknown as MediaStreamTrack],
    } as unknown as MediaStream;
    const rec = createRecorder({
      stream,
      mimeType: "audio/webm;codecs=opus",
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
    });
    rec.start();
    rec.cancel();
    expect(trackStop).toHaveBeenCalled();
    expect(rec.state).toBe("stopped");
  });

  it("rejects start() when not idle", () => {
    const rec = createRecorder({
      stream: fakeStream(),
      mimeType: "audio/webm;codecs=opus",
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
    });
    rec.start();
    expect(() => rec.start()).toThrow();
  });
});

describe("requestMic", () => {
  let savedDescriptor: PropertyDescriptor | undefined;
  beforeEach(() => {
    savedDescriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  });
  afterEach(() => {
    if (savedDescriptor) {
      Object.defineProperty(navigator, "mediaDevices", savedDescriptor);
    } else {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: undefined,
      });
    }
  });

  function stubMediaDevices(getUserMedia: () => Promise<MediaStream>) {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
  }

  it("throws permission-denied on NotAllowedError", async () => {
    stubMediaDevices(async () => {
      throw new DOMException("denied", "NotAllowedError");
    });
    await expect(requestMic()).rejects.toMatchObject({ kind: "permission-denied" });
  });

  it("throws no-device on NotFoundError", async () => {
    stubMediaDevices(async () => {
      throw new DOMException("missing", "NotFoundError");
    });
    await expect(requestMic()).rejects.toMatchObject({ kind: "no-device" });
  });

  it("throws unavailable when mediaDevices is missing", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    await expect(requestMic()).rejects.toMatchObject({ kind: "unavailable" });
  });
});

describe("memo helpers", () => {
  it("filename follows memo-<iso>.<ext> convention", () => {
    const at = new Date("2026-04-19T14:30:05.123Z");
    expect(memoFilename("audio/webm;codecs=opus", at)).toBe("memo-2026-04-19T14-30-05-123.webm");
    expect(memoFilename("audio/mp4", at)).toBe("memo-2026-04-19T14-30-05-123.m4a");
  });

  it("path slots into Memos/YYYY/MM-DD/HH-MM-SS", () => {
    const at = new Date(2026, 3, 19, 14, 30, 5);
    expect(memoPath(at)).toBe("Memos/2026/04-19/14-30-05");
  });

  it("note content embeds the filename as a wiki-attachment", () => {
    const at = new Date("2026-04-19T14:30:00.000Z");
    const body = memoNoteContent("memo-x.webm", at);
    expect(body).toContain("🎙️ Voice memo");
    expect(body).toContain("![[memo-x.webm]]");
    expect(body).toContain("Transcript pending");
  });
});
