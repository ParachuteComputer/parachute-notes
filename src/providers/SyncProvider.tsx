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
}

const SyncCtx = createContext<SyncContext>({
  db: null,
  blobStore: null,
  engine: null,
  isOnline: true,
});

export function useSync(): SyncContext {
  return useContext(SyncCtx);
}

export function SyncProvider({ children }: { children: ReactNode }): ReactNode {
  const [db, setDb] = useState<LensDB | null>(null);
  const [blobStore, setBlobStore] = useState<BlobStore | null>(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
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
      onDrain: (outcome) => {
        if (outcome.drained > 0) {
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
    () => ({ db, blobStore, engine, isOnline }),
    [db, blobStore, engine, isOnline],
  );

  return <SyncCtx.Provider value={value}>{children}</SyncCtx.Provider>;
}
