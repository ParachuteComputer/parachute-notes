import { Capture, extractHashtags } from "@/app/routes/Capture";
import { type LensDB, openLensDB } from "@/lib/sync/db";
import { listPending } from "@/lib/sync/queue";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { SyncProvider } from "@/providers/SyncProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeController {
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<{ data: ArrayBuffer; mimeType: string; durationMs: number }>;
  cancel: () => void;
  state: "idle" | "recording" | "paused" | "stopped";
  mimeType: string;
}

const fakeState = {
  controller: null as FakeController | null,
  requestMic: vi.fn(async () => ({ getTracks: () => [] }) as unknown as MediaStream),
  pickResult: "audio/webm;codecs=opus" as string | null,
};

vi.mock("@/lib/capture/recorder", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/capture/recorder")>("@/lib/capture/recorder");
  return {
    ...actual,
    pickMimeType: () => fakeState.pickResult,
    requestMic: () => fakeState.requestMic(),
    createRecorder: (opts: { mimeType: string }) => {
      const c: FakeController = {
        state: "idle",
        mimeType: opts.mimeType,
        start() {
          this.state = "recording";
        },
        pause() {
          this.state = "paused";
        },
        resume() {
          this.state = "recording";
        },
        async stop() {
          this.state = "stopped";
          return {
            data: new Uint8Array([10, 20, 30]).buffer,
            mimeType: opts.mimeType,
            durationMs: 4_200,
          };
        },
        cancel() {
          this.state = "stopped";
        },
      };
      fakeState.controller = c;
      return c;
    },
  };
});

function seedStore() {
  useVaultStore.setState({
    vaults: {
      dev: {
        id: "dev",
        url: "http://localhost:1940",
        name: "dev",
        issuer: "http://localhost:1940",
        clientId: "client-test",
        scope: "full",
        addedAt: "2026-04-18T00:00:00.000Z",
        lastUsedAt: "2026-04-18T00:00:00.000Z",
      },
    },
    activeVaultId: "dev",
  });
  localStorage.setItem(
    "lens:token:dev",
    JSON.stringify({ accessToken: "pvt_abc", scope: "full", vault: "default" }),
  );
}

async function freshDb(): Promise<LensDB> {
  indexedDB.deleteDatabase("parachute-lens");
  return openLensDB();
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <SyncProvider>{children}</SyncProvider>
    </QueryClientProvider>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/capture" element={<Capture />} />
        <Route path="/" element={<div>HomePage</div>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: Wrapper },
  );
}

// Hold-to-record relies on the global pointerup listener — dispatching a real
// PointerEvent from the textarea or button doesn't bubble far enough in jsdom.
function releasePointer() {
  window.dispatchEvent(new Event("pointerup"));
}

async function waitForReady() {
  await waitFor(() => {
    expect(screen.getByLabelText(/capture content/i)).toBeInTheDocument();
  });
}

describe("Capture (unified)", () => {
  let restoreOnline: (() => void) | null = null;

  beforeEach(async () => {
    const db = await freshDb();
    db.close();
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    seedStore();
    fakeState.controller = null;
    fakeState.pickResult = "audio/webm;codecs=opus";
    fakeState.requestMic = vi.fn(async () => ({ getTracks: () => [] }) as unknown as MediaStream);
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:fake"),
        revokeObjectURL: vi.fn(),
      }),
    );
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    restoreOnline = () => {
      if (desc) Object.defineProperty(navigator, "onLine", desc);
    };
  });

  afterEach(() => {
    restoreOnline?.();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("redirects to / when no active vault", () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    renderAt("/capture");
    expect(screen.getByText("HomePage")).toBeInTheDocument();
  });

  it("renders the textarea and a hold-to-record mic button", async () => {
    renderAt("/capture");
    await waitForReady();
    expect(screen.getByLabelText(/capture content/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hold to record/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^capture$/i })).toBeDisabled();
  });

  it("text-only submit enqueues create-note with the captureText role tag and extracted hashtags", async () => {
    renderAt("/capture");
    await waitForReady();
    const textarea = screen.getByLabelText(/capture content/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "got an #idea on the bus" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^capture$/i }));
    });

    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.message === "Captured.")).toBe(true);
    });

    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    expect(rows.length).toBe(1);
    if (rows[0]?.mutation.kind !== "create-note") throw new Error("expected create-note");
    expect(rows[0].mutation.payload.content).toBe("got an #idea on the bus");
    expect(rows[0].mutation.payload.path).toBeUndefined();
    expect(rows[0].mutation.payload.tags).toEqual(["quick", "idea"]);
    db.close();
  });

  it("hold-to-record + release + Capture enqueues create-note + upload + link with transcribe:true", async () => {
    renderAt("/capture");
    await waitForReady();

    await act(async () => {
      fireEvent.pointerDown(screen.getByRole("button", { name: /hold to record/i }));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /recording/i })).toBeInTheDocument();
    });

    await act(async () => {
      releasePointer();
    });

    await waitFor(() => {
      expect(screen.getByText(/recorded /i)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^capture$/i }));
    });

    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.tone === "success")).toBe(true);
    });

    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    const kinds = rows.map((r) => r.mutation.kind);
    expect(kinds).toEqual(["create-note", "upload-attachment", "link-attachment"]);

    const create = rows.find((r) => r.mutation.kind === "create-note")!;
    const upload = rows.find((r) => r.mutation.kind === "upload-attachment")!;
    const link = rows.find((r) => r.mutation.kind === "link-attachment")!;
    if (
      create.mutation.kind !== "create-note" ||
      upload.mutation.kind !== "upload-attachment" ||
      link.mutation.kind !== "link-attachment"
    ) {
      throw new Error("wrong mutation shape");
    }
    expect(create.mutation.payload.path).toMatch(/^Memos\//);
    expect(create.mutation.payload.tags).toEqual(["voice"]);
    expect(create.mutation.payload.content).toContain("_Transcript pending._");
    expect(create.mutation.payload.content).toContain("![[");
    expect(link.mutation.pathRef).toBe(`blob:${upload.mutation.blobId}`);
    expect(link.mutation.transcribe).toBe(true);
    db.close();
  });

  it("text + voice combined keeps the typed body, drops the placeholder body, and applies both role tags", async () => {
    renderAt("/capture");
    await waitForReady();
    const textarea = screen.getByLabelText(/capture content/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "context for the recording #meeting" } });
    });

    await act(async () => {
      fireEvent.pointerDown(screen.getByRole("button", { name: /hold to record/i }));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /recording/i })).toBeInTheDocument();
    });
    await act(async () => {
      releasePointer();
    });
    await waitFor(() => {
      expect(screen.getByText(/recorded /i)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^capture$/i }));
    });

    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.tone === "success")).toBe(true);
    });

    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    const create = rows.find((r) => r.mutation.kind === "create-note")!;
    if (create.mutation.kind !== "create-note") throw new Error("wrong mutation shape");
    // Combined notes don't pin to Memos/ — they belong with the user's other notes.
    expect(create.mutation.payload.path).toBeUndefined();
    expect(create.mutation.payload.content).toContain("context for the recording #meeting");
    expect(create.mutation.payload.content).toContain("![[");
    expect(create.mutation.payload.tags).toEqual(["quick", "voice", "meeting"]);
    db.close();
  });

  it("Cmd+Enter in the textarea submits", async () => {
    renderAt("/capture");
    await waitForReady();
    const textarea = screen.getByLabelText(/capture content/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "shortcut" } });
    });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    });
    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.message === "Captured.")).toBe(true);
    });
    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    expect(rows.length).toBe(1);
    db.close();
  });

  it("permission denied surfaces a friendly error and does not advance phase", async () => {
    fakeState.requestMic = vi.fn(async () => {
      const err = Object.assign(new Error("denied"), { kind: "permission-denied" });
      throw err;
    });
    renderAt("/capture");
    await waitForReady();
    await act(async () => {
      fireEvent.pointerDown(screen.getByRole("button", { name: /hold to record/i }));
    });
    await waitFor(() => {
      expect(screen.getByText(/microphone access was denied/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/recorded /i)).not.toBeInTheDocument();
  });

  it("Discard drops the recorded audio and returns to idle", async () => {
    renderAt("/capture");
    await waitForReady();
    await act(async () => {
      fireEvent.pointerDown(screen.getByRole("button", { name: /hold to record/i }));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /recording/i })).toBeInTheDocument();
    });
    await act(async () => {
      releasePointer();
    });
    await waitFor(() => {
      expect(screen.getByText(/recorded /i)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    });

    expect(screen.queryByText(/recorded /i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hold to record/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^capture$/i })).toBeDisabled();
  });

  it("unmount with dirty text content flushes the draft to the queue", async () => {
    function Toggler() {
      const [mounted, setMounted] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setMounted(false)}>
            unmount
          </button>
          {mounted ? <Capture /> : <div>unmounted</div>}
        </>
      );
    }
    render(
      <MemoryRouter>
        <Toggler />
      </MemoryRouter>,
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(screen.getByLabelText(/capture content/i)).toBeInTheDocument();
    });
    const textarea = screen.getByLabelText(/capture content/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "walked away mid-thought" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "unmount" }));
    });
    await waitFor(() => {
      expect(screen.getByText("unmounted")).toBeInTheDocument();
    });
    await waitFor(async () => {
      const db = await openLensDB();
      const rows = await listPending(db, "dev");
      db.close();
      expect(rows.length).toBe(1);
    });
    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    if (rows[0]?.mutation.kind === "create-note") {
      expect(rows[0].mutation.payload.content).toBe("walked away mid-thought");
      expect(rows[0].mutation.payload.tags).toEqual(["quick"]);
    }
    db.close();
  });

  it("unmount fired during save() does not double-enqueue (#95)", async () => {
    // Race: user types, hits Capture, then immediately navigates away while
    // the enqueue is still in flight. save() already started the create-note
    // enqueue; the unmount-flush must not fire a second one.
    function Toggler() {
      const [mounted, setMounted] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setMounted(false)}>
            unmount
          </button>
          {mounted ? <Capture /> : <div>unmounted</div>}
        </>
      );
    }
    render(
      <MemoryRouter>
        <Toggler />
      </MemoryRouter>,
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(screen.getByLabelText(/capture content/i)).toBeInTheDocument();
    });
    const textarea = screen.getByLabelText(/capture content/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "racing the unmount" } });
    });
    // Click Capture and unmount in the same act() — both effects flush before
    // the test reads the queue, so we observe whatever both code paths
    // enqueue. With the bug, that's two rows.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^capture$/i }));
      fireEvent.click(screen.getByRole("button", { name: "unmount" }));
    });
    await waitFor(() => {
      expect(screen.getByText("unmounted")).toBeInTheDocument();
    });
    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    expect(rows.length).toBe(1);
    db.close();
  });

  it("unmount with empty content does NOT enqueue", async () => {
    function Toggler() {
      const [mounted, setMounted] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setMounted(false)}>
            unmount
          </button>
          {mounted ? <Capture /> : <div>unmounted</div>}
        </>
      );
    }
    render(
      <MemoryRouter>
        <Toggler />
      </MemoryRouter>,
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(screen.getByLabelText(/capture content/i)).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "unmount" }));
    });
    await waitFor(() => {
      expect(screen.getByText("unmounted")).toBeInTheDocument();
    });
    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    expect(rows.length).toBe(0);
    db.close();
  });
});

describe("extractHashtags", () => {
  it("pulls #tag tokens from prose and dedups them", () => {
    expect(extractHashtags("got an #idea today and another #idea")).toEqual(["idea"]);
  });

  it("ignores in-word # (only word-boundary matches)", () => {
    expect(extractHashtags("foo#bar baz #real")).toEqual(["real"]);
  });

  it("matches at the start of the string", () => {
    expect(extractHashtags("#first thing")).toEqual(["first"]);
  });

  it("returns an empty array for tagless text", () => {
    expect(extractHashtags("nothing tagged here")).toEqual([]);
  });

  it("preserves the as-typed casing (normalizer trims, doesn't lowercase)", () => {
    // Two distinct tokens because tags are case-sensitive in the vault — we
    // dedup exact repeats only.
    expect(extractHashtags("#Idea and #idea today #Idea")).toEqual(["Idea", "idea"]);
  });
});
