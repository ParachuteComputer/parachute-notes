import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { VaultClient } from "./client";
import { useVaultReachabilityStore } from "./reachability-store";

// Drives the recovery probe for a vault stuck in `retrying` or `down`. Reads
// `nextProbeAt` from the store, schedules a single `setTimeout`, and fires
// `client.vaultInfo()` when it elapses. Success → the client's own
// `onReachability("healthy")` flush in client.ts handles the state reset,
// and we invalidate React Query so stale data refetches. Failure → the
// client emits another `unreachable` signal, the store extends the backoff,
// and this hook re-arms for the new `nextProbeAt`.
//
// Why a hook and not part of the store: the probe needs the active
// VaultClient (the store can't construct one — no token plumbing) and needs
// to invalidate the query cache on recovery (couples to React Query, which
// can't live below the provider). Single instance is fine — wired alongside
// the auth-halt cross-tab listener at App.tsx root.

export function useReachabilityProbe(vaultId: string | null, client: VaultClient | null): void {
  const entry = useVaultReachabilityStore((s) => (vaultId ? s.byVault[vaultId] : undefined));
  const qc = useQueryClient();

  useEffect(() => {
    if (!vaultId || !client || !entry || entry.state === "healthy") return;
    if (entry.nextProbeAt === null) return;

    const now = Date.now();
    const delay = Math.max(0, entry.nextProbeAt - now);
    let cancelled = false;

    const timer = setTimeout(() => {
      if (cancelled) return;
      // vaultInfo() is cheap (the route exists on every vault, includes
      // optional stats we ignore) and exercises the same path the app uses.
      // Auth errors are fine — those still mean the vault is reachable, the
      // client will flush to healthy and the auth-halt store will own the
      // separate "needs reconnect" surface.
      void client
        .vaultInfo(false)
        .then(() => {
          // Client already called onReachability("healthy") — extra safety:
          // invalidate so React Query refetches now that we're back.
          qc.invalidateQueries({ queryKey: ["notes", vaultId] });
          qc.invalidateQueries({ queryKey: ["tags", vaultId] });
          qc.invalidateQueries({ queryKey: ["vaultInfo", vaultId] });
          qc.invalidateQueries({ queryKey: ["note", vaultId] });
        })
        .catch(() => {
          // Failure path is already captured by the client's onReachability.
          // Don't double-report here.
        });
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Re-arm whenever `nextProbeAt` changes (a fresh failure pushed it out)
    // or recovery clears it. `qc` is stable per-provider.
  }, [vaultId, client, entry, qc]);
}
