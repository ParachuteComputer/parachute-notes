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

// Toggle to make the next `enqueue` call throw — used by the catch-path
// regression test to simulate a failed save and verify the savingRef leak fix.
const enqueueState = vi.hoisted(() => ({ failNext: false }));

vi.mock("@/lib/sync", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sync")>("@/lib/sync");
  return {
    ...actual,
    enqueue: async (...args: Parameters<typeof actual.enqueue>) => {
      if (enqueueState.failNext) {
        enqueueState.failNext = false;
        throw new Error("simulated enqueue failure");
      }
      return actual.enqueue(...args);
    },
  };
});

// Schema-ensure (notes#126 reshape) calls a real `PUT /api/tags/:name` via
// the active vault client. Capture tests don't stub fetch at the network
// boundary — they stub at the `enqueue` boundary — so the schema-ensure
// fetch would hang the test environment for 10s+ per case. Stub the
// ensure module to a no-op here; schema-ensure has its own focused tests
// in `schema-ensure.test.ts` that exercise the real path.
vi.mock("@/lib/vault/schema-ensure", () => ({
  ensureNotesSchema: vi.fn(async () => {}),
}));

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
    // Pre-fill from notes#126: pathOverride is now seeded with `quickPath()`
    // on mount, so the payload's path is `Notes/<YYYY>/<MM-DD>/<HH-MM-SS>`.
    // Asserting on the prefix keeps the test stable across clock minutes.
    expect(rows[0].mutation.payload.path).toMatch(/^Notes\/\d{4}\/\d{2}-\d{2}\/\d{2}-\d{2}-\d{2}$/);
    // notes#126 reshape: default captureText role is "capture/text" (was "quick").
    expect(rows[0].mutation.payload.tags).toEqual(["capture/text", "idea"]);
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
    // With notes#126's pre-fill + option (d), audio-only captures also
    // land under Notes/<date>/<time> by default. The `memoPath()`
    // fallback was dropped in the reshape — one canonical Notes-side
    // rule, no phase-dependent forks. Clearing the path reverts to the
    // same generated value (see the "audio-only with cleared path" test
    // below).
    expect(create.mutation.payload.path).toMatch(/^Notes\/\d{4}\/\d{2}-\d{2}\/\d{2}-\d{2}-\d{2}$/);
    // notes#126 reshape: default captureVoice role is "capture/voice" (was "voice").
    expect(create.mutation.payload.tags).toEqual(["capture/voice"]);
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
    // Pre-fill from notes#126: combined text+voice notes also carry the
    // quickPath value (used to be `undefined` here, meaning vault picks).
    // They no longer pin to Memos/ — they belong with the user's other notes.
    expect(create.mutation.payload.path).toMatch(/^Notes\/\d{4}\/\d{2}-\d{2}\/\d{2}-\d{2}-\d{2}$/);
    expect(create.mutation.payload.content).toContain("context for the recording #meeting");
    expect(create.mutation.payload.content).toContain("![[");
    // notes#126 reshape: both default capture roles are hierarchical now.
    expect(create.mutation.payload.tags).toEqual(["capture/text", "capture/voice", "meeting"]);
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
      expect(rows[0].mutation.payload.tags).toEqual(["capture/text"]);
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

  it("failed save releases savingRef so a later unmount-flush still flushes the draft (#96 follow-up)", async () => {
    // Regression for the savingRef leak on the catch path: if save() failed
    // (network/quota/whatever) and the user kept editing then navigated away,
    // the unmount-flush would bail unconditionally and silently drop the
    // draft. After the fix, savingRef resets in the catch block so the
    // unmount-flush still enqueues the latest content.
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

    enqueueState.failNext = true;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "first attempt" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^capture$/i }));
    });
    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.tone === "error")).toBe(true);
    });

    // Save failed — the queue should still be empty.
    {
      const db = await openLensDB();
      const rows = await listPending(db, "dev");
      expect(rows.length).toBe(0);
      db.close();
    }

    // Type more after the failure, then navigate away. The unmount-flush
    // should fire because savingRef was released in the catch block.
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "kept typing after failure" } });
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
      expect(rows[0].mutation.payload.content).toBe("kept typing after failure");
    }
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

describe("Capture — More fields panel (path + summary overrides)", () => {
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

  it("More fields disclosure is collapsed by default", async () => {
    renderAt("/capture");
    await waitForReady();
    // The Path input lives inside <details>; jsdom keeps it in the DOM, but
    // the parent's `open` attribute is what governs visibility. Assert on
    // the attribute so we test the actual behavior, not a CSS detail.
    const summary = screen.getByText(/^more fields$/i);
    const details = summary.closest("details");
    expect(details).toBeTruthy();
    expect(details?.open).toBe(false);
  });

  it("Path override → enqueued create-note carries `path`; tags + content unchanged", async () => {
    renderAt("/capture");
    await waitForReady();

    // Open the disclosure first — jsdom doesn't dispatch toggle on click of
    // the summary alone (it's a quirk), so set the open prop directly via
    // the user-facing affordance.
    const detailsEl = screen.getByText(/^more fields$/i).closest("details")!;
    await act(async () => {
      detailsEl.open = true;
      detailsEl.dispatchEvent(new Event("toggle"));
    });

    const textarea = screen.getByLabelText(/capture content/i) as HTMLTextAreaElement;
    const pathInput = screen.getByLabelText(/path override/i) as HTMLInputElement;
    const summaryInput = screen.getByLabelText(/^summary$/i) as HTMLInputElement;

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "lab notes #wip" } });
      fireEvent.change(pathInput, { target: { value: "Daily/2026-05-12" } });
      fireEvent.change(summaryInput, { target: { value: "first pass" } });
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
    const payload = rows[0].mutation.payload;
    expect(payload.path).toBe("Daily/2026-05-12");
    expect(payload.metadata).toEqual({ summary: "first pass" });
    expect(payload.tags).toEqual(["capture/text", "wip"]);
    expect(payload.content).toBe("lab notes #wip");
    db.close();
  });

  it("Empty path override reverts to the mount-time generated path (option d)", async () => {
    // notes#126 reshape, option (d): clearing the path input never falls
    // back to vault-auto-assign. The generated `quickPath()` value captured
    // on mount is the truth-default; emptying the input reverts to that
    // same value at save time. Aaron's framing: "vault auto-assigns" hides
    // what's happening, so empty-input must not surface that magic again.
    renderAt("/capture");
    await waitForReady();
    const detailsEl = screen.getByText(/^more fields$/i).closest("details")!;
    await act(async () => {
      detailsEl.open = true;
      detailsEl.dispatchEvent(new Event("toggle"));
    });

    const textarea = screen.getByLabelText(/capture content/i) as HTMLTextAreaElement;
    const pathInput = screen.getByLabelText(/path override/i) as HTMLInputElement;
    const generated = pathInput.value;
    expect(generated).toMatch(/^Notes\/\d{4}\/\d{2}-\d{2}\/\d{2}-\d{2}-\d{2}$/);

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "no path here" } });
      // Whitespace-only is treated as empty per the trim().
      fireEvent.change(pathInput, { target: { value: "   " } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^capture$/i }));
    });

    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.message === "Captured.")).toBe(true);
    });

    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    if (rows[0]?.mutation.kind !== "create-note") throw new Error("expected create-note");
    // Empty input → mount-time generated value, not undefined.
    expect(rows[0].mutation.payload.path).toBe(generated);
    expect(rows[0].mutation.payload.metadata).toBeUndefined();
    db.close();
  });

  it("Path override wins over the generated default (audio-only)", async () => {
    renderAt("/capture");
    await waitForReady();
    const detailsEl = screen.getByText(/^more fields$/i).closest("details")!;
    await act(async () => {
      detailsEl.open = true;
      detailsEl.dispatchEvent(new Event("toggle"));
    });

    // Set path override BEFORE recording so it sticks through the save flow.
    const pathInput = screen.getByLabelText(/path override/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(pathInput, { target: { value: "Recordings/2026/may" } });
    });

    // Record audio only (no text).
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
    if (create.mutation.kind !== "create-note") throw new Error("expected create-note");
    expect(create.mutation.payload.path).toBe("Recordings/2026/may");
    db.close();
  });

  it("Pre-filled path is editable and the edit is what's saved (notes#126)", async () => {
    // The path-override input is now pre-filled with `quickPath()` on
    // mount (notes#126). This test confirms (a) the input renders with
    // a non-empty value, and (b) editing replaces that value cleanly —
    // no merging, no append.
    renderAt("/capture");
    await waitForReady();
    const detailsEl = screen.getByText(/^more fields$/i).closest("details")!;
    await act(async () => {
      detailsEl.open = true;
      detailsEl.dispatchEvent(new Event("toggle"));
    });

    const pathInput = screen.getByLabelText(/path override/i) as HTMLInputElement;
    // Pre-fill is non-empty and matches the quickPath shape.
    expect(pathInput.value).toMatch(/^Notes\/\d{4}\/\d{2}-\d{2}\/\d{2}-\d{2}-\d{2}$/);

    // Edit the input to a custom value.
    await act(async () => {
      fireEvent.change(pathInput, { target: { value: "Projects/2026/q2/launch" } });
    });

    const textarea = screen.getByLabelText(/capture content/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "kickoff notes" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^capture$/i }));
    });
    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.message === "Captured.")).toBe(true);
    });

    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    if (rows[0]?.mutation.kind !== "create-note") throw new Error("expected create-note");
    expect(rows[0].mutation.payload.path).toBe("Projects/2026/q2/launch");
    db.close();
  });

  it("Audio-only with manually cleared path reverts to the generated path (option d)", async () => {
    // notes#126 reshape, option (d): clearing the path is NOT an escape
    // hatch back to historical rules. It reverts to the mount-time
    // `quickPath()` value. One canonical Notes-side rule, no phase-
    // dependent forks. Audio captures via this path land under
    // `Notes/<date>/<time>` just like text captures.
    renderAt("/capture");
    await waitForReady();
    const detailsEl = screen.getByText(/^more fields$/i).closest("details")!;
    await act(async () => {
      detailsEl.open = true;
      detailsEl.dispatchEvent(new Event("toggle"));
    });

    const pathInput = screen.getByLabelText(/path override/i) as HTMLInputElement;
    const generated = pathInput.value;
    expect(generated).toMatch(/^Notes\/\d{4}\/\d{2}-\d{2}\/\d{2}-\d{2}-\d{2}$/);

    await act(async () => {
      fireEvent.change(pathInput, { target: { value: "" } });
    });

    // Audio-only — no text typed.
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
    if (create.mutation.kind !== "create-note") throw new Error("expected create-note");
    expect(create.mutation.payload.path).toBe(generated);
    db.close();
  });

  it("Regenerates the path on reset when operator hasn't edited (notes#126 collision fix)", async () => {
    // Reviewer raised this in #130: `quickPath()` is second-granularity,
    // so two captures within the same second produce the same path —
    // collision. The reshape regenerates on `reset()` AFTER successful
    // save, but only when the operator hasn't manually edited. We need
    // wall-clock time to actually move BEFORE the reset's quickPath()
    // call to see a different value — use fake timers and advance the
    // clock *before* the save click so reset() reads the advanced time.
    const tFirst = new Date(2026, 4, 12, 14, 30, 5).getTime();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(tFirst);
    try {
      renderAt("/capture");
      await waitForReady();
      const detailsEl = screen.getByText(/^more fields$/i).closest("details")!;
      await act(async () => {
        detailsEl.open = true;
        detailsEl.dispatchEvent(new Event("toggle"));
      });

      const pathInput = screen.getByLabelText(/path override/i) as HTMLInputElement;
      const first = pathInput.value;
      expect(first).toBe("Notes/2026/05-12/14-30-05");

      const textarea = screen.getByLabelText(/capture content/i) as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(textarea, { target: { value: "thought one" } });
      });

      // Advance wall-clock BEFORE the click so reset()'s quickPath() reads
      // the new value. Two captures within the same wall-clock second is
      // the collision case; the regen-on-reset is the fix.
      await act(async () => {
        vi.setSystemTime(tFirst + 7_000);
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^capture$/i }));
      });
      await waitFor(() => {
        expect(useToastStore.getState().toasts.some((t) => t.message === "Captured.")).toBe(true);
      });

      // After reset(), the input value should have regenerated.
      const second = pathInput.value;
      expect(second).toBe("Notes/2026/05-12/14-30-12");
      expect(second).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Preserves a user-edited path across reset (no regen)", async () => {
    // Counter-test for the collision fix: if the operator typed an
    // explicit path, they're capturing multiple notes into the same
    // place (e.g. `Daily/2026-05-12`). Don't fight them.
    renderAt("/capture");
    await waitForReady();
    const detailsEl = screen.getByText(/^more fields$/i).closest("details")!;
    await act(async () => {
      detailsEl.open = true;
      detailsEl.dispatchEvent(new Event("toggle"));
    });

    const pathInput = screen.getByLabelText(/path override/i) as HTMLInputElement;
    const userPath = "Daily/2026-05-12";
    await act(async () => {
      fireEvent.change(pathInput, { target: { value: userPath } });
    });

    const textarea = screen.getByLabelText(/capture content/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "first daily" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^capture$/i }));
    });
    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.message === "Captured.")).toBe(true);
    });

    // After reset, the user-typed path should still be in the input.
    expect(pathInput.value).toBe(userPath);
  });
});

describe("Capture — inactivity autosave (5s)", () => {
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
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    restoreOnline?.();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("typing + 5s of inactivity fires draftSave() in the background", async () => {
    // rc.10 redesign: autosave is now a silent background draft (NOT a
    // finalize-and-clear). After 5s of inactivity, the create-note hits
    // the queue but the textarea content stays — the user can keep typing.
    // No toast (it's not a user action), no `phase: "saving"` (no textarea
    // disable). The visible signal is the "Draft saved" pill below.
    renderAt("/capture");
    await waitForReady();
    const textarea = screen.getByLabelText(/capture content/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "auto-saved thought" } });
    });

    // Advance just under the 5s threshold — should NOT have saved yet.
    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    let db = await openLensDB();
    expect((await listPending(db, "dev")).length).toBe(0);
    db.close();

    // Cross the threshold.
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });

    await waitFor(async () => {
      const dbInner = await openLensDB();
      const rows = await listPending(dbInner, "dev");
      dbInner.close();
      expect(rows.length).toBe(1);
    });

    db = await openLensDB();
    const rows = await listPending(db, "dev");
    if (rows[0]?.mutation.kind !== "create-note") throw new Error("expected create-note");
    expect(rows[0].mutation.payload.content).toBe("auto-saved thought");
    db.close();

    // Content is preserved (not cleared by a reset).
    expect(textarea.value).toBe("auto-saved thought");
    // No "Captured." toast — that's reserved for explicit Capture clicks.
    expect(useToastStore.getState().toasts.some((t) => t.message === "Captured.")).toBe(false);
  });

  it("further edits within the 5s window reset the timer (draft-save)", async () => {
    renderAt("/capture");
    await waitForReady();
    const textarea = screen.getByLabelText(/capture content/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "first" } });
    });
    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    // Edit again before the timer fires — counter should restart.
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "first plus more" } });
    });
    await act(async () => {
      vi.advanceTimersByTime(4_500);
    });
    // 8.5s elapsed, but only 4.5s since the last keystroke — should NOT have
    // saved yet.
    let db = await openLensDB();
    expect((await listPending(db, "dev")).length).toBe(0);
    db.close();

    // Cross the 5s window from the last edit.
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await waitFor(async () => {
      const dbInner = await openLensDB();
      const rows = await listPending(dbInner, "dev");
      dbInner.close();
      expect(rows.length).toBe(1);
    });
    db = await openLensDB();
    const rows = await listPending(db, "dev");
    if (rows[0]?.mutation.kind !== "create-note") throw new Error("expected create-note");
    expect(rows[0].mutation.payload.content).toBe("first plus more");
    db.close();
  });

  it("empty content → autosave does NOT fire", async () => {
    renderAt("/capture");
    await waitForReady();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    const db = await openLensDB();
    expect((await listPending(db, "dev")).length).toBe(0);
    db.close();
  });

  it("staged audio suppresses autosave (manual Capture click only)", async () => {
    renderAt("/capture");
    await waitForReady();
    const textarea = screen.getByLabelText(/capture content/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "with audio attached" } });
    });
    // Record + release so phase enters `have-audio`.
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
      vi.advanceTimersByTime(10_000);
    });
    const db = await openLensDB();
    expect((await listPending(db, "dev")).length).toBe(0);
    db.close();
  });

  it("second autosave after first enqueues update-note (rc.10 draft-save)", async () => {
    // rc.10 redesign: autosave is now a background draft. First fire
    // enqueues create-note; second fire on the same mount enqueues
    // update-note targeting the same localId — NOT a second create. The
    // textarea content is preserved across autosaves so the user can keep
    // typing into the same thought.
    renderAt("/capture");
    await waitForReady();
    const textarea = screen.getByLabelText(/capture content/i) as HTMLTextAreaElement;

    // First autosave — enqueues create-note.
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "first thought" } });
    });
    await act(async () => {
      vi.advanceTimersByTime(5_500);
    });
    await waitFor(async () => {
      const dbInner = await openLensDB();
      const rows = await listPending(dbInner, "dev");
      dbInner.close();
      expect(rows.length).toBe(1);
    });
    let db = await openLensDB();
    let rows = await listPending(db, "dev");
    expect(rows[0]?.mutation.kind).toBe("create-note");
    db.close();

    // Textarea content is preserved — user keeps editing the same thought.
    expect(textarea.value).toBe("first thought");

    // Type more, wait for second autosave — should enqueue update-note.
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "first thought, expanded" } });
    });
    await act(async () => {
      vi.advanceTimersByTime(5_500);
    });
    await waitFor(async () => {
      const dbInner = await openLensDB();
      const rs = await listPending(dbInner, "dev");
      dbInner.close();
      expect(rs.length).toBe(2);
    });
    db = await openLensDB();
    rows = await listPending(db, "dev");
    expect(rows[0]?.mutation.kind).toBe("create-note");
    expect(rows[1]?.mutation.kind).toBe("update-note");
    if (rows[1]?.mutation.kind === "update-note") {
      expect(rows[1].mutation.payload.content).toBe("first thought, expanded");
    }
    db.close();
    // No "Captured." toasts during background drafts.
    expect(useToastStore.getState().toasts.some((t) => t.message === "Captured.")).toBe(false);
  });

  it("unmount-flush after a successful autosave still flushes new typed content", async () => {
    // Companion regression: after an autosave succeeds, the user types more
    // and navigates away. If savingRef leaks, the unmount-flush silently
    // drops the new content. Uses the Toggler pattern (rather than RTL's
    // `unmount()`) so the SyncProvider's IDB handle stays open while the
    // unmount-flush enqueue runs — same shape as the existing
    // "unmount with dirty text" test for the same reason.
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
      fireEvent.change(textarea, { target: { value: "first" } });
    });
    await act(async () => {
      vi.advanceTimersByTime(5_500);
    });
    // Wait for the first draft to land in the queue.
    await waitFor(async () => {
      const db = await openLensDB();
      const rows = await listPending(db, "dev");
      db.close();
      expect(rows.length).toBe(1);
    });

    // Type more (the textarea is preserved across the autosave under
    // rc.10's draft-save model — no clobber), then unmount before the
    // next timer fires.
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "post-autosave draft" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "unmount" }));
    });
    await waitFor(() => {
      expect(screen.getByText("unmounted")).toBeInTheDocument();
    });

    // Unmount-flush should have written an update-note for the in-flight
    // draft (NOT a fresh create-note that would duplicate the row).
    await waitFor(async () => {
      const db = await openLensDB();
      const rows = await listPending(db, "dev");
      db.close();
      expect(rows.length).toBe(2);
    });
    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    expect(rows[0]?.mutation.kind).toBe("create-note");
    expect(rows[1]?.mutation.kind).toBe("update-note");
    if (rows[0]?.mutation.kind === "create-note") {
      expect(rows[0].mutation.payload.content).toBe("first");
    }
    if (rows[1]?.mutation.kind === "update-note") {
      expect(rows[1].mutation.payload.content).toBe("post-autosave draft");
    }
    db.close();
  });

  it("manual Capture during draftSave's in-flight create routes to update-note (notes#135 race)", async () => {
    // notes#135 race: in rc.10 the draftSave path set
    // `{ localId, hasEnqueuedCreate: false }` BEFORE awaiting the
    // create-note enqueue, then flipped to `true` AFTER. During that
    // await window, a manual Capture click read `hasEnqueuedCreate ===
    // false` and fell into the fresh-create else branch — enqueuing a
    // SECOND create-note row with the same localId. Fix: flip the
    // committed-flag SYNCHRONOUSLY before the await so a racing manual
    // save sees the post-create state and routes to update-note.
    //
    // We can't directly stall the real `enqueue` to widen the window
    // (the test mock wraps the real one). Instead we drive the timer
    // to fire `draftSave` and IMMEDIATELY (synchronously, same React
    // batch) click Capture — both code paths run their pre-await
    // setup in the same tick. With the bug, the queue ends up with
    // two create-note rows (same localId). With the fix, the queue
    // has one create-note + one update-note.
    renderAt("/capture");
    await waitForReady();
    const textarea = screen.getByLabelText(/capture content/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "racing the autosave" } });
    });
    // Single act() that fires the autosave timer AND clicks Capture —
    // both code paths read draftRef before either await resolves.
    await act(async () => {
      vi.advanceTimersByTime(5_500);
      fireEvent.click(screen.getByRole("button", { name: /^capture$/i }));
    });

    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.message === "Captured.")).toBe(true);
    });

    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    db.close();
    const kinds = rows.map((r) => r.mutation.kind);
    // Exactly one create-note (from the autosave), exactly one update-note
    // (from the racing manual Capture) — NOT two create-notes.
    expect(kinds.filter((k) => k === "create-note").length).toBe(1);
    expect(kinds.filter((k) => k === "update-note").length).toBe(1);
    // The create + update share the same localId / targetId so the drain
    // resolves them as a single note. Pre-fix: two create-notes with
    // identical localId would either dedupe vault-side (best case) or
    // duplicate the note (worst case).
    const create = rows.find((r) => r.mutation.kind === "create-note")!;
    const update = rows.find((r) => r.mutation.kind === "update-note")!;
    if (create.mutation.kind !== "create-note" || update.mutation.kind !== "update-note") {
      throw new Error("wrong mutation shape");
    }
    expect(update.mutation.targetId).toBe(create.mutation.localId);
  });

  it("unmount during draftSave's in-flight create routes to update-note (notes#135 race)", async () => {
    // Companion race for the unmount path: in rc.10 the unmount-flush
    // checked `draft?.hasEnqueuedCreate` and fell back to create-note
    // when false, even though draftSave had already committed to
    // enqueueing a create for that localId. After the fix, the
    // committed-flag flips synchronously so the unmount-flush sees
    // the post-create state and enqueues update-note.
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
      fireEvent.change(textarea, { target: { value: "racing the unmount-flush" } });
    });
    // Fire autosave + unmount in the same act() so both code paths
    // read draftRef before draftSave's create-note await resolves.
    await act(async () => {
      vi.advanceTimersByTime(5_500);
      fireEvent.click(screen.getByRole("button", { name: "unmount" }));
    });
    await waitFor(() => {
      expect(screen.getByText("unmounted")).toBeInTheDocument();
    });

    await waitFor(async () => {
      const db = await openLensDB();
      const rows = await listPending(db, "dev");
      db.close();
      expect(rows.length).toBe(2);
    });
    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    db.close();
    const kinds = rows.map((r) => r.mutation.kind);
    // One create (autosave) + one update (unmount-flush) — never two creates.
    expect(kinds.filter((k) => k === "create-note").length).toBe(1);
    expect(kinds.filter((k) => k === "update-note").length).toBe(1);
  });

  it("failed create-note draftSave resets draft so the next autosave creates fresh (notes#135)", async () => {
    // Race-fix companion: with the create-committed flag set
    // synchronously, a create-note enqueue that THROWS must roll the
    // ref back to null. Otherwise the next autosave reads `draft !==
    // null` + `createCommitted: true` and enqueues update-note for a
    // localId that was never actually created — orphan PATCH at the
    // vault. The catch block now resets draftRef to null specifically
    // on fresh-create failure (update-note failures leave the ref
    // alone, since the create already shipped).
    renderAt("/capture");
    await waitForReady();
    const textarea = screen.getByLabelText(/capture content/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "first attempt" } });
    });

    // First autosave: simulate a failure.
    enqueueState.failNext = true;
    await act(async () => {
      vi.advanceTimersByTime(5_500);
    });
    // Wait long enough for the failed enqueue's promise to settle.
    await act(async () => {
      await Promise.resolve();
    });
    // Queue still empty — the first create-note attempt threw.
    {
      const db = await openLensDB();
      const rows = await listPending(db, "dev");
      db.close();
      expect(rows.length).toBe(0);
    }

    // Type more — fresh keystroke restarts the 5s timer.
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "first attempt plus more" } });
    });
    await act(async () => {
      vi.advanceTimersByTime(5_500);
    });
    await waitFor(async () => {
      const db = await openLensDB();
      const rows = await listPending(db, "dev");
      db.close();
      expect(rows.length).toBe(1);
    });
    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    db.close();
    // The second autosave must enqueue create-note (NOT update-note for
    // the rolled-back localId).
    expect(rows[0]?.mutation.kind).toBe("create-note");
    if (rows[0]?.mutation.kind === "create-note") {
      expect(rows[0].mutation.payload.content).toBe("first attempt plus more");
    }
  });

  it("draft-saved indicator re-renders so relativeTime tracks wall-clock (notes#135)", async () => {
    // notes#135 indicator staleness: in rc.10 the "Draft saved · just
    // now" label was computed at render time from `draftSavedAt`, but
    // nothing else in the component changed between autosaves — so
    // the label could stay at "just now" for a long idle even though
    // wall-clock had moved on. Fix: 15s setInterval bumps a tick
    // state while a draft is in flight, forcing a re-render.
    //
    // Test by triggering a draft, then advancing wall-clock past the
    // "just now" threshold (1 minute). The label must transition to
    // "1m ago" WITHOUT any user interaction. Pre-fix the label
    // freezes at "just now"; post-fix the interval bumps a tick that
    // re-renders the indicator.
    const t0 = new Date(2026, 4, 21, 12, 0, 0).getTime();
    vi.setSystemTime(t0);
    renderAt("/capture");
    await waitForReady();
    const textarea = screen.getByLabelText(/capture content/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "indicator test" } });
    });
    // Trigger the autosave.
    await act(async () => {
      vi.advanceTimersByTime(5_500);
    });
    await waitFor(async () => {
      const db = await openLensDB();
      const rows = await listPending(db, "dev");
      db.close();
      expect(rows.length).toBe(1);
    });
    // Right after the draft lands the label is "just now".
    expect(screen.getByText(/Draft saved · just now/)).toBeInTheDocument();

    // Advance wall-clock 70s WITHOUT any user interaction. The 15s
    // tick interval should fire ~4 times in this window; the most
    // recent tick re-renders the indicator AFTER `relativeTime()`
    // crosses the 1-minute boundary, so the label moves from "just
    // now" to "1m ago".
    await act(async () => {
      vi.advanceTimersByTime(70_000);
    });
    expect(screen.getByText(/Draft saved · 1m ago/)).toBeInTheDocument();
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
