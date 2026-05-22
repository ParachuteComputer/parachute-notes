import { type LensDB, openLensDB } from "@/lib/sync/db";
import { isLocalId } from "@/lib/sync/id-map";
import { countPending, listPending } from "@/lib/sync/queue";
import { SyncProvider, useSync } from "@/providers/SyncProvider";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCreateNote, useDeleteNote, useUpdateNote } from "./queries";
import { saveToken } from "./storage";
import { useVaultStore } from "./store";

async function freshDb(): Promise<LensDB> {
  indexedDB.deleteDatabase("parachute-lens");
  return openLensDB();
}

function setOnline(online: boolean): () => void {
  const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
  return () => {
    if (desc) Object.defineProperty(navigator, "onLine", desc);
  };
}

// Hook that combines the mutation under test with the sync context so the
// caller can wait for the provider's DB to finish opening.
function useCreateWithSync() {
  return { mutation: useCreateNote(), sync: useSync() };
}
function useDeleteWithSync() {
  return { mutation: useDeleteNote(), sync: useSync() };
}
function useUpdateWithSync(id: string) {
  return { mutation: useUpdateNote(id), sync: useSync() };
}

function wrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  return ({ children }) => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return (
      <QueryClientProvider client={qc}>
        <SyncProvider>{children}</SyncProvider>
      </QueryClientProvider>
    );
  };
}

describe("mutation hooks — offline dispatch", () => {
  let db: LensDB;
  let restoreOnline: () => void;

  beforeEach(async () => {
    db = await freshDb();
    db.close();
    localStorage.clear();
    useVaultStore.setState({
      vaults: {
        v1: {
          id: "v1",
          url: "https://example.test",
          name: "Test",
          issuer: "https://example.test",
          clientId: "cid",
          scope: "full",
          addedAt: "2026-01-01T00:00:00Z",
          lastUsedAt: "2026-01-01T00:00:00Z",
        },
      },
      activeVaultId: "v1",
    });
    restoreOnline = setOnline(false);
  });

  afterEach(() => {
    restoreOnline();
  });

  it("useCreateNote enqueues and returns an optimistic note when offline", async () => {
    const { result } = renderHook(() => useCreateWithSync(), { wrapper: wrapper() });
    await waitFor(() => {
      expect(result.current.sync.db).not.toBeNull();
    });

    let created: unknown;
    await act(async () => {
      created = await result.current.mutation.mutateAsync({
        content: "# Offline note",
        path: "Inbox/offline",
      });
    });
    const note = created as { id: string; content?: string };
    expect(isLocalId(note.id)).toBe(true);
    expect(note.content).toBe("# Offline note");

    const sharedDb = await openLensDB();
    await waitFor(async () => {
      expect(await countPending(sharedDb, "v1")).toBeGreaterThan(0);
    });
    const rows = await listPending(sharedDb, "v1");
    expect(rows[0].mutation.kind).toBe("create-note");
    if (rows[0].mutation.kind === "create-note") {
      expect(rows[0].mutation.payload.path).toBe("Inbox/offline");
    }
    sharedDb.close();
  });

  it("useDeleteNote enqueues a delete-note row when offline", async () => {
    const { result } = renderHook(() => useDeleteWithSync(), { wrapper: wrapper() });
    await waitFor(() => {
      expect(result.current.sync.db).not.toBeNull();
    });
    await act(async () => {
      await result.current.mutation.mutateAsync("srv-42");
    });
    const sharedDb = await openLensDB();
    const rows = await listPending(sharedDb, "v1");
    expect(rows[0].mutation.kind).toBe("delete-note");
    sharedDb.close();
  });

  it("useUpdateNote enqueues an update-note row when offline", async () => {
    const { result } = renderHook(() => useUpdateWithSync("srv-42"), { wrapper: wrapper() });
    await waitFor(() => {
      expect(result.current.sync.db).not.toBeNull();
    });
    await act(async () => {
      await result.current.mutation.mutateAsync({ content: "# updated" });
    });
    const sharedDb = await openLensDB();
    const rows = await listPending(sharedDb, "v1");
    expect(rows[0].mutation.kind).toBe("update-note");
    sharedDb.close();
  });

  it("useUpdateNote captures baselineUpdatedAt from the cached note", async () => {
    // The drain handler uses this as `if_updated_at` so an offline write
    // doesn't silently overwrite a peer's edit (notes#84). Verify it's
    // populated from the QueryClient cache at enqueue time.
    function useUpdateWithSeededCache(id: string) {
      const qc = useQueryClient();
      const update = useUpdateNote(id);
      const sync = useSync();
      return { qc, update, sync };
    }

    const { result } = renderHook(() => useUpdateWithSeededCache("srv-42"), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.sync.db).not.toBeNull();
    });
    act(() => {
      result.current.qc.setQueryData(["note", "v1", "srv-42"], {
        id: "srv-42",
        createdAt: "2026-04-20T00:00:00Z",
        updatedAt: "2026-04-26T12:00:00Z",
      });
    });
    await act(async () => {
      await result.current.update.mutateAsync({ content: "# updated" });
    });

    const sharedDb = await openLensDB();
    const rows = await listPending(sharedDb, "v1");
    expect(rows[0].mutation.kind).toBe("update-note");
    if (rows[0].mutation.kind === "update-note") {
      expect(rows[0].mutation.baselineUpdatedAt).toBe("2026-04-26T12:00:00Z");
    }
    sharedDb.close();
  });
});

// These tests cover the try-with-timeout + fallback behavior added for
// issue #61: in installed-PWA standalone mode `navigator.onLine` is
// unreliable, so a "known-offline" fast-path isn't enough — a bounded
// network attempt must also fall back to enqueue on failure.
describe("mutation hooks — online with offline fallback", () => {
  let db: LensDB;
  let restoreOnline: () => void;

  beforeEach(async () => {
    db = await freshDb();
    db.close();
    localStorage.clear();
    useVaultStore.setState({
      vaults: {
        v1: {
          id: "v1",
          url: "https://example.test",
          name: "Test",
          issuer: "https://example.test",
          clientId: "cid",
          scope: "full",
          addedAt: "2026-01-01T00:00:00Z",
          lastUsedAt: "2026-01-01T00:00:00Z",
        },
      },
      activeVaultId: "v1",
    });
    // A token has to exist for useActiveVaultClient to build a real client,
    // which is what exercises the timeout / network-error paths.
    saveToken("v1", { accessToken: "tok", scope: "full", vault: "https://example.test" });
    restoreOnline = setOnline(true);
  });

  afterEach(() => {
    restoreOnline();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("falls back to enqueue when a network POST rejects while onLine is true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    const { result } = renderHook(() => useCreateWithSync(), { wrapper: wrapper() });
    await waitFor(() => {
      expect(result.current.sync.db).not.toBeNull();
    });

    let created: unknown;
    await act(async () => {
      created = await result.current.mutation.mutateAsync({
        content: "# from false-online",
        path: "Inbox/fallback",
      });
    });
    const note = created as { id: string };
    expect(isLocalId(note.id)).toBe(true);

    const sharedDb = await openLensDB();
    await waitFor(async () => {
      expect(await countPending(sharedDb, "v1")).toBeGreaterThan(0);
    });
    const rows = await listPending(sharedDb, "v1");
    expect(rows[0].mutation.kind).toBe("create-note");
    sharedDb.close();
  });

  it("falls back to enqueue when the network POST exceeds the offline timeout", async () => {
    // Fetch never settles — only an AbortSignal abort will end it.
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    );

    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { result } = renderHook(() => useCreateWithSync(), { wrapper: wrapper() });
    await waitFor(() => {
      expect(result.current.sync.db).not.toBeNull();
    });

    let createdPromise: Promise<unknown> | undefined;
    act(() => {
      createdPromise = result.current.mutation.mutateAsync({
        content: "# slow",
        path: "Inbox/slow",
      });
    });

    // Advance past the 8s fallback window so the AbortController fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });

    const created = (await createdPromise) as { id: string };
    expect(isLocalId(created.id)).toBe(true);

    vi.useRealTimers();
    const sharedDb = await openLensDB();
    await waitFor(async () => {
      expect(await countPending(sharedDb, "v1")).toBeGreaterThan(0);
    });
    sharedDb.close();
  });
});

describe("mutation hooks — no offline queue available", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  // When the sync DB never opens (private-mode IDB failure, or provider not
  // mounted) AND there's no active vault client, a known-offline mutation
  // can't enqueue and can't POST — it must throw so the UI surfaces the
  // real failure instead of hanging on "Creating…".
  function wrapperNoSync(): ({ children }: { children: ReactNode }) => ReactNode {
    return ({ children }) => {
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    };
  }

  it("useCreateNote throws when offline, db is null, and no vault is active", async () => {
    const restore = setOnline(false);
    try {
      const { result } = renderHook(() => useCreateNote(), { wrapper: wrapperNoSync() });
      await expect(result.current.mutateAsync({ content: "# x", path: "Inbox/x" })).rejects.toThrow(
        /No active vault/,
      );
    } finally {
      restore();
    }
  });
});
