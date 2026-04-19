import { type LensDB, openLensDB } from "@/lib/sync/db";
import { isLocalId } from "@/lib/sync/id-map";
import { countPending, listPending } from "@/lib/sync/queue";
import { SyncProvider, useSync } from "@/providers/SyncProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCreateNote, useDeleteNote, useUpdateNote } from "./queries";
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
});
