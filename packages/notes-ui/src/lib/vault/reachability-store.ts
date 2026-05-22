import { create } from "zustand";

// Per-vault reachability state — the axis the auth-halt store doesn't cover.
// Mirrors `useAuthHaltStore` in shape (per-vault entries, store + actions)
// but is NOT persisted: reachability is transient, a reload should re-probe
// from scratch rather than carry a stale "down" verdict across sessions. The
// auth halt persists because re-auth is the only fix; reachability resolves
// itself the next time the vault answers.
//
// State machine:
//   healthy  ── failure ──▶ retrying        (1st-2nd consecutive failure)
//   retrying ── failure ──▶ down            (≥3 consecutive failures)
//   retrying ── success ──▶ healthy         (recovery on next 2xx/4xx)
//   down     ── success ──▶ healthy         (recovery — banner clears,
//                                            React Query resumes)
//
// The store owns hysteresis; the client owns the raw signal (every fetch
// outcome calls `reportSignal`). UI reads `byVault[id].state` to pick its
// tone. The probe scheduler (separate hook, not on the store) reads
// `nextProbeAt` to decide when to attempt the next recovery ping.

export type ReachabilityState = "healthy" | "retrying" | "down";

export interface ReachabilityEntry {
  vaultId: string;
  state: ReachabilityState;
  consecutiveFailures: number;
  lastErrorAt: number | null;
  lastErrorReason: string | null;
  // Wall-clock ms when the recovery probe should next attempt a ping. Set on
  // every failure (exponential backoff); cleared on healthy. The probe hook
  // reads this and `setTimeout`s a probe.
  nextProbeAt: number | null;
  // Backoff index — incremented per consecutive failure, capped so we don't
  // overflow. Probe delay is BACKOFF_MS_BY_INDEX[Math.min(index, last)].
  backoffIndex: number;
}

// Promotion threshold: 3rd consecutive failure flips retrying → down. Caught
// in `reportFailure`. Lower than this and we'd churn the banner on a single
// dropped packet; higher and the user waits too long for actionable info.
export const DOWN_THRESHOLD = 3;

// Exponential backoff for the recovery probe. Each consecutive failure picks
// the next index (capped at the last entry, so we don't grow unbounded). 30s
// cap matches the sync engine tick — a vault that stays down longer than
// that will already be picked up by the engine's regular drain attempt.
export const BACKOFF_MS_BY_INDEX = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

interface ReachabilityStoreState {
  byVault: Record<string, ReachabilityEntry>;
  // Called by VaultClient.onReachability — promotes through the state machine
  // and schedules the next probe time. Pure: side-effect free aside from the
  // store write; the actual probe `setTimeout` lives in the hook.
  reportSignal: (vaultId: string, signal: "healthy" | "unreachable", reason?: string) => void;
  // Test/dev escape hatch — force-reset a vault back to healthy without
  // waiting for a real probe. Also used by the banner's "Retry now" button
  // before it invalidates queries.
  resetToHealthy: (vaultId: string) => void;
}

function emptyEntry(vaultId: string): ReachabilityEntry {
  return {
    vaultId,
    state: "healthy",
    consecutiveFailures: 0,
    lastErrorAt: null,
    lastErrorReason: null,
    nextProbeAt: null,
    backoffIndex: 0,
  };
}

function nextBackoffMs(backoffIndex: number): number {
  const i = Math.min(backoffIndex, BACKOFF_MS_BY_INDEX.length - 1);
  return BACKOFF_MS_BY_INDEX[i] ?? BACKOFF_MS_BY_INDEX[BACKOFF_MS_BY_INDEX.length - 1] ?? 30_000;
}

export const useVaultReachabilityStore = create<ReachabilityStoreState>((set) => ({
  byVault: {},

  reportSignal(vaultId, signal, reason) {
    set((s) => {
      const prev = s.byVault[vaultId] ?? emptyEntry(vaultId);

      if (signal === "healthy") {
        // No-op if the vault has no entry (already healthy by absence). Keep
        // the byVault object identity stable so subscribers don't re-render
        // on every successful fetch.
        if (!(vaultId in s.byVault)) return s;
        // Delete the entry rather than write `emptyEntry`. Healthy is the
        // absence of a problem; using deletion matches the auth-halt store's
        // shape and keeps `Object.keys(byVault)` an accurate "vaults with
        // active issues" set for any future code that wants it.
        const { [vaultId]: _removed, ...rest } = s.byVault;
        return { byVault: rest };
      }

      const consecutiveFailures = prev.consecutiveFailures + 1;
      const backoffIndex = prev.backoffIndex + 1;
      const state: ReachabilityState = consecutiveFailures >= DOWN_THRESHOLD ? "down" : "retrying";
      const now = Date.now();
      const next: ReachabilityEntry = {
        vaultId,
        state,
        consecutiveFailures,
        lastErrorAt: now,
        lastErrorReason: reason ?? null,
        nextProbeAt: now + nextBackoffMs(backoffIndex),
        backoffIndex,
      };
      return { byVault: { ...s.byVault, [vaultId]: next } };
    });
  },

  resetToHealthy(vaultId) {
    set((s) => {
      if (!(vaultId in s.byVault)) return s;
      const { [vaultId]: _removed, ...rest } = s.byVault;
      return { byVault: rest };
    });
  },
}));
