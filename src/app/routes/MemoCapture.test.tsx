import { MemoCapture } from "@/app/routes/MemoCapture";
import { type LensDB, openLensDB } from "@/lib/sync/db";
import { listPending } from "@/lib/sync/queue";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { SyncProvider } from "@/providers/SyncProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock just the parts of the recorder module that touch browser APIs. The
// helpers (memoFilename, memoPath, memoNoteContent, pickMimeType) run for
// real.
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
        <Route path="/capture" element={<MemoCapture />} />
        <Route path="/notes" element={<div>NotesListPage</div>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: Wrapper },
  );
}

describe("MemoCapture route", () => {
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
    // URL.createObjectURL / revokeObjectURL don't exist in jsdom.
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:fake"),
        revokeObjectURL: vi.fn(),
      }),
    );
    // Pin navigator.onLine=false so the SyncEngine no-ops — we're verifying
    // the enqueue path, not the drain path.
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

  it("shows the idle state with a Start recording button", async () => {
    renderAt("/capture");
    expect(screen.getByRole("button", { name: /start recording/i })).toBeInTheDocument();
  });

  it("permission denied shows the friendly retry affordance", async () => {
    fakeState.requestMic = vi.fn(async () => {
      const err = Object.assign(new Error("denied"), {
        kind: "permission-denied",
      });
      throw err;
    });
    renderAt("/capture");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    });
    await waitFor(() => {
      expect(screen.getByText(/microphone access was denied/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("unsupported browser shows an error if no mimeType matches", async () => {
    fakeState.pickResult = null;
    renderAt("/capture");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    });
    await waitFor(() => {
      expect(screen.getByText(/can't record audio/i)).toBeInTheDocument();
    });
  });

  it("record → stop → save enqueues create-note, upload-attachment, link-attachment", async () => {
    renderAt("/capture");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^stop$/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^stop$/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save memo/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save memo/i }));
    });

    // Lands on /notes with a toast and three queue rows.
    await waitFor(() => {
      expect(screen.getByText("NotesListPage")).toBeInTheDocument();
    });
    expect(useToastStore.getState().toasts[0]?.message).toContain("Memo saved");

    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    const kinds = rows.map((r) => r.mutation.kind);
    expect(kinds).toEqual(["create-note", "upload-attachment", "link-attachment"]);
    // The link-attachment row should reference the blob of the upload row via blob:<id>.
    const link = rows.find((r) => r.mutation.kind === "link-attachment")!;
    const upload = rows.find((r) => r.mutation.kind === "upload-attachment")!;
    if (link.mutation.kind !== "link-attachment" || upload.mutation.kind !== "upload-attachment") {
      throw new Error("wrong mutation shape");
    }
    expect(link.mutation.pathRef).toBe(`blob:${upload.mutation.blobId}`);
    expect(link.mutation.mimeType).toBe("audio/webm;codecs=opus");
    if (rows[0].mutation.kind === "create-note") {
      expect(rows[0].mutation.payload.path).toMatch(/^Memos\//);
      expect(rows[0].mutation.payload.tags).toEqual(["voice"]);
    }
    // Without scribe configured, upload-attachment should not retain the blob.
    if (upload.mutation.kind === "upload-attachment") {
      expect(upload.mutation.retain).not.toBe(true);
    }
    db.close();
  });

  it("enqueues a transcribe-memo row when scribe is configured", async () => {
    localStorage.setItem(
      "lens:scribe:dev",
      JSON.stringify({ url: "http://scribe.local:3200", cleanup: false }),
    );
    renderAt("/capture");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^stop$/i })).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^stop$/i }));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save memo/i })).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save memo/i }));
    });
    await waitFor(() => {
      expect(screen.getByText("NotesListPage")).toBeInTheDocument();
    });

    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    const kinds = rows.map((r) => r.mutation.kind);
    expect(kinds).toEqual([
      "create-note",
      "upload-attachment",
      "link-attachment",
      "transcribe-memo",
    ]);
    const upload = rows.find((r) => r.mutation.kind === "upload-attachment")!;
    if (upload.mutation.kind === "upload-attachment") {
      expect(upload.mutation.retain).toBe(true);
    }
    const transcribe = rows.find((r) => r.mutation.kind === "transcribe-memo")!;
    if (transcribe.mutation.kind === "transcribe-memo") {
      expect(transcribe.mutation.marker).toBe("_Transcript pending._");
      expect(transcribe.mutation.blobId).toBe(
        upload.mutation.kind === "upload-attachment" ? upload.mutation.blobId : "",
      );
    }
    db.close();
  });

  it("discard & re-record drops the review and returns to idle", async () => {
    renderAt("/capture");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^stop$/i }));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save memo/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    });

    expect(screen.getByRole("button", { name: /start recording/i })).toBeInTheDocument();
  });

  it("pause → resume keeps the recording going", async () => {
    renderAt("/capture");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^pause$/i })).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^resume$/i })).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^resume$/i }));
    });
    expect(screen.getByRole("button", { name: /^pause$/i })).toBeInTheDocument();
  });
});
