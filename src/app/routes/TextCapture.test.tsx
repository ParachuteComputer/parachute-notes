import { TextCapture } from "@/app/routes/TextCapture";
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
        <Route path="/capture" element={<TextCapture />} />
        <Route path="/" element={<div>NotesListPage</div>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: Wrapper },
  );
}

describe("TextCapture route", () => {
  let restoreOnline: (() => void) | null = null;

  beforeEach(async () => {
    const db = await freshDb();
    db.close();
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    seedStore();
    // Pin offline so the sync engine no-ops — we only verify enqueue.
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    restoreOnline = () => {
      if (desc) Object.defineProperty(navigator, "onLine", desc);
    };
  });

  afterEach(() => {
    restoreOnline?.();
    vi.restoreAllMocks();
  });

  async function waitForSync() {
    // SyncProvider opens IDB asynchronously; first render has db=null.
    await waitFor(() => {
      expect(screen.getByLabelText(/quick note content/i)).toBeInTheDocument();
    });
  }

  it("shows disabled Capture button when content is empty", async () => {
    renderAt("/capture");
    await waitForSync();
    expect(screen.getByRole("button", { name: /^capture$/i })).toBeDisabled();
    expect(screen.getByText(/nothing to save/i)).toBeInTheDocument();
  });

  it("Cmd+Enter enqueues a create-note and resets the editor", async () => {
    renderAt("/capture");
    await waitForSync();
    const textarea = screen.getByLabelText(/quick note content/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "a thought" } });
    });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    });
    // Let the enqueue/toast flush.
    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.message === "Captured.")).toBe(true);
    });
    expect(textarea.value).toBe("");

    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    expect(rows.length).toBe(1);
    expect(rows[0]?.mutation.kind).toBe("create-note");
    if (rows[0]?.mutation.kind === "create-note") {
      expect(rows[0].mutation.payload.content).toBe("a thought");
      expect(rows[0].mutation.payload.tags).toEqual(["quick"]);
      expect(rows[0].mutation.payload.path).toBeUndefined();
    }
    db.close();
  });

  it("Capture button enqueues on click", async () => {
    renderAt("/capture");
    await waitForSync();
    const textarea = screen.getByLabelText(/quick note content/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "another" } });
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
    db.close();
  });

  it("discards whitespace-only content without enqueueing", async () => {
    renderAt("/capture");
    await waitForSync();
    const textarea = screen.getByLabelText(/quick note content/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "   \n  " } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^capture$/i }));
    });
    // Button was disabled — click is a no-op; no toast + no row.
    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    expect(rows.length).toBe(0);
    db.close();
  });

  it("unmount with dirty content flushes the draft to the queue", async () => {
    // Toggle-only-the-TextCapture so the SyncProvider (and its DB) stays
    // mounted and the fire-and-forget enqueue can land before verify.
    function Toggler() {
      const [mounted, setMounted] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setMounted(false)}>
            unmount-text
          </button>
          {mounted ? <TextCapture /> : <div>unmounted</div>}
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
      expect(screen.getByLabelText(/quick note content/i)).toBeInTheDocument();
    });
    const textarea = screen.getByLabelText(/quick note content/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "walked away mid-thought" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "unmount-text" }));
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
    }
    db.close();
  });

  it("unmount with empty content does NOT enqueue", async () => {
    function Toggler() {
      const [mounted, setMounted] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setMounted(false)}>
            unmount-text
          </button>
          {mounted ? <TextCapture /> : <div>unmounted</div>}
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
      expect(screen.getByLabelText(/quick note content/i)).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "unmount-text" }));
    });
    await waitFor(() => {
      expect(screen.getByText("unmounted")).toBeInTheDocument();
    });
    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    expect(rows.length).toBe(0);
    db.close();
  });

  it("tags can be added and removed; custom tags replace the default", async () => {
    renderAt("/capture");
    await waitForSync();
    const textarea = screen.getByLabelText(/quick note content/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "tagged" } });
    });
    // Remove default "quick"
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /remove tag quick/i }));
    });
    // Add a custom tag
    const tagInput = screen.getByLabelText(/add tag/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(tagInput, { target: { value: "idea" } });
      fireEvent.keyDown(tagInput, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^capture$/i }));
    });
    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.message === "Captured.")).toBe(true);
    });
    const db = await openLensDB();
    const rows = await listPending(db, "dev");
    if (rows[0]?.mutation.kind === "create-note") {
      expect(rows[0].mutation.payload.tags).toEqual(["idea"]);
    }
    db.close();
  });
});
