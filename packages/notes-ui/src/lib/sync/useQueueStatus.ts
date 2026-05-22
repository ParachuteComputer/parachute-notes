// Polls the sync queue for UI surfaces (status indicator, status panel,
// per-note transcription chip). Intentionally lightweight — no
// subscribe/notify plumbing. Drains run on a 30s tick and whenever the
// engine fires onDrain; a 2s poll is enough for human-scale visible state.

import { useEffect, useRef, useState } from "react";
import { AUTH_HALT_META, type LensDB, type PendingRow, listPending } from ".";
import { getMeta } from "./db";
import type { PendingKind } from "./types";

export interface AuthHaltInfo {
  vaultId: string;
  at: number;
  message: string;
}

export interface QueueStatus {
  rows: PendingRow[];
  byKind: Partial<Record<PendingKind, number>>;
  total: number;
  pendingCount: number;
  needsHumanCount: number;
  authHalt: AuthHaltInfo | null;
}

const EMPTY: QueueStatus = {
  rows: [],
  byKind: {},
  total: 0,
  pendingCount: 0,
  needsHumanCount: 0,
  authHalt: null,
};

export function useQueueStatus(
  db: LensDB | null,
  vaultId: string | null,
  pollMs = 2_000,
): QueueStatus {
  const [status, setStatus] = useState<QueueStatus>(EMPTY);
  // Ref so the polling effect doesn't need to re-subscribe on every render.
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!db || !vaultId) {
      setStatus(EMPTY);
      return;
    }
    let timer: ReturnType<typeof setInterval> | null = null;

    const refresh = async () => {
      try {
        const [rows, halt] = await Promise.all([
          listPending(db, vaultId),
          getMeta<AuthHaltInfo>(db, AUTH_HALT_META),
        ]);
        if (cancelledRef.current) return;
        const byKind: Partial<Record<PendingKind, number>> = {};
        let pendingCount = 0;
        let needsHumanCount = 0;
        for (const row of rows) {
          const k = row.mutation.kind;
          byKind[k] = (byKind[k] ?? 0) + 1;
          if (row.status === "needs-human") needsHumanCount += 1;
          else pendingCount += 1;
        }
        // Ignore halt meta that belongs to a different vault — each vault
        // carries its own auth state.
        const activeHalt = halt && halt.vaultId === vaultId ? halt : null;
        setStatus({
          rows,
          byKind,
          total: rows.length,
          pendingCount,
          needsHumanCount,
          authHalt: activeHalt,
        });
      } catch {
        // Transient IDB errors (eg. db closing during unmount) are fine to
        // swallow — the next tick will refresh.
      }
    };

    void refresh();
    timer = setInterval(refresh, pollMs);
    return () => {
      cancelledRef.current = true;
      if (timer) clearInterval(timer);
    };
  }, [db, vaultId, pollMs]);

  return status;
}
