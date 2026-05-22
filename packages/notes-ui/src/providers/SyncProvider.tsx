import { type BlobStore, createBlobStore } from "@/lib/sync/blob-store";
import { type LensDB, openLensDB } from "@/lib/sync/db";
import { SyncEngine } from "@/lib/sync/engine";
import { requestPersistent } from "@/lib/sync/storage-quota";
import { useActiveVaultClient } from "@/lib/vault/queries";
import { useVaultStore } from "@/lib/vault/store";
import { useQueryClient } from "@tanstack/react-query";
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface SyncContext {
  db: LensDB | null;
  blobStore: BlobStore | null;
  engine: SyncEngine | null;
  isOnline: boolean;
  // Flipped by the engine around each drain attempt. UI shows a subtle
  // "syncing" affordance while true.
  isDraining: boolean;
  // Wall-clock ms of the most recent drain that actually flushed rows. Null
  // if nothing has drained since mount. Persisted to localStorage so the
  // status panel can show a meaningful "Last synced" across reloads.
  lastSyncedAt: number | null;
}

const LAST_SYNCED_KEY = "lens:sync:lastSyncedAt";

function loadLastSyncedAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_SYNCED_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

const SyncCtx = createContext<SyncContext>({
  db: null,
  blobStore: null,
  engine: null,
  isOnline: true,
  isDraining: false,
  lastSyncedAt: null,
});

export function useSync(): SyncContext {
  return useContext(SyncCtx);
}

// Provider-scoped IndexedDB lifecycle: the DB handle is opened on mount and
// closed on unmount. When writing tests that unmount route components which
// perform fire-and-forget enqueues during cleanup (e.g. TextCapture's
// unmount-flush), be aware that the provider's cleanup closes the DB in the
// same tick — if both unmount together, in-flight IDB transactions race the
// close and fake-indexeddb raises InvalidStateError. Real SPA navigation
// doesn't tear down the provider, so to reproduce the true shape in tests,
// toggle only the inner component's mount (see TextCapture.test.tsx for the
// pattern) rather than unmounting the whole render tree.
export function SyncProvider({ children }: { children: ReactNode }): ReactNode {
  const [db, setDb] = useState<LensDB | null>(null);
  const [blobStore, setBlobStore] = useState<BlobStore | null>(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [isDraining, setIsDraining] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(() => loadLastSyncedAt());
  const client = useActiveVaultClient();
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const qc = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    let openedHandle: LensDB | null = null;
    openLensDB()
      .then((handle) => {
        if (cancelled) {
          handle.close();
          return;
        }
        openedHandle = handle;
        setDb(handle);
        setBlobStore(createBlobStore(handle));
        void requestPersistent();
      })
      .catch(() => {
        // IDB unavailable (privacy mode, Safari edge cases) — the app still
        // works, just without an offline queue. The mutation hooks fall back
        // to direct calls.
      });
    return () => {
      cancelled = true;
      openedHandle?.close();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);

  // The engine outlives a single render, but its callbacks need the current
  // client / vault id / query client. Stash those in refs so the useMemo deps
  // stay stable (only rebuild when the DB handle swaps).
  const clientRef = useRef(client);
  const activeVaultIdRef = useRef(activeVaultId);
  const qcRef = useRef(qc);
  clientRef.current = client;
  activeVaultIdRef.current = activeVaultId;
  qcRef.current = qc;

  const engine = useMemo(() => {
    if (!db || !blobStore) return null;
    return new SyncEngine({
      db,
      blobStore,
      resolveContext: () => {
        const c = clientRef.current;
        const v = activeVaultIdRef.current;
        if (!c || !v) return null;
        return { client: c, vaultId: v };
      },
      onDrainStart: () => {
        setIsDraining(true);
      },
      onDrain: (outcome) => {
        setIsDraining(false);
        if (outcome.drained > 0) {
          const now = Date.now();
          setLastSyncedAt(now);
          try {
            localStorage.setItem(LAST_SYNCED_KEY, String(now));
          } catch {
            // quota/private-mode — not worth surfacing
          }
          const v = activeVaultIdRef.current;
          qcRef.current.invalidateQueries({ queryKey: ["notes", v] });
          qcRef.current.invalidateQueries({ queryKey: ["tags", v] });
          qcRef.current.invalidateQueries({ queryKey: ["vaultInfo", v] });
        }
      },
    });
  }, [db, blobStore]);

  useEffect(() => {
    if (!engine) return;
    engine.start();
    return () => engine.stop();
  }, [engine]);

  const value = useMemo<SyncContext>(
    () => ({ db, blobStore, engine, isOnline, isDraining, lastSyncedAt }),
    [db, blobStore, engine, isOnline, isDraining, lastSyncedAt],
  );

  return <SyncCtx.Provider value={value}>{children}</SyncCtx.Provider>;
}
