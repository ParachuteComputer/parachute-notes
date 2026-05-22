import { create } from "zustand";
import type { VaultClient } from "./client";
import { type SchemaAuditResult, auditSchema } from "./schema-audit";

// Volatile per-vault audit result. NOT persisted — runs fresh on every
// vault add / switch / manual refresh. The persisted state (whether the
// banner is dismissed) lives in `schema-banner-store.ts`.
//
// Mirror of `auth-halt-store` shape: per-vault entries, three methods
// (run, refresh, clear). The "loading" state is per-vault rather than a
// single boolean because a fast vault-switch could overlap audits on
// two different vault ids.

export interface SchemaAuditEntry {
  vaultId: string;
  // Most recent result. `null` while the first audit is in flight.
  result: SchemaAuditResult | null;
  // True while a fetch is in flight. UI uses this for the spinner /
  // disabled state on the Refresh button.
  loading: boolean;
  // Set when the fetch errors (network failure, 401 before refresh).
  // The Settings panel shows it; the connect-time banner stays hidden
  // (no banner is better than a misleading one).
  error: string | null;
  // Wall-clock ms of the most recent successful result. UI shows
  // "Last checked: 2 min ago" for the operator.
  lastCheckedAt: number | null;
}

interface SchemaAuditState {
  byVault: Record<string, SchemaAuditEntry>;
  // Run-or-skip: if the cached result is fresh enough (default 5 min) and
  // matches the requested vault, returns the existing entry without
  // re-fetching. Connect-time banner + Settings auto-load use this.
  ensure: (vaultId: string, client: VaultClient) => Promise<void>;
  // Force a fresh audit regardless of cache age. Settings "Refresh" button.
  refresh: (vaultId: string, client: VaultClient) => Promise<void>;
  // Drop a vault's entry (e.g. on vault removal).
  clear: (vaultId: string) => void;
  // Replace an entry directly — used by the fix path so the post-fix
  // re-audit's result becomes the canonical entry without going through
  // a second `auditSchema` call.
  set: (vaultId: string, result: SchemaAuditResult) => void;
}

const FRESH_MS = 5 * 60 * 1_000;

function startEntry(prev: SchemaAuditEntry | undefined, vaultId: string): SchemaAuditEntry {
  return {
    vaultId,
    result: prev?.result ?? null,
    loading: true,
    error: null,
    lastCheckedAt: prev?.lastCheckedAt ?? null,
  };
}

async function runAudit(
  vaultId: string,
  client: VaultClient,
  set: (updater: (s: SchemaAuditState) => Partial<SchemaAuditState>) => void,
): Promise<void> {
  try {
    const result = await auditSchema(client);
    set((s) => ({
      byVault: {
        ...s.byVault,
        [vaultId]: {
          vaultId,
          result,
          loading: false,
          error: null,
          lastCheckedAt: Date.now(),
        },
      },
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    set((s) => ({
      byVault: {
        ...s.byVault,
        [vaultId]: {
          ...(s.byVault[vaultId] ?? startEntry(undefined, vaultId)),
          loading: false,
          error: message,
        },
      },
    }));
  }
}

export const useSchemaAuditStore = create<SchemaAuditState>((set, get) => ({
  byVault: {},

  async ensure(vaultId, client) {
    const existing = get().byVault[vaultId];
    if (existing?.result && existing.lastCheckedAt) {
      if (Date.now() - existing.lastCheckedAt < FRESH_MS) return;
    }
    if (existing?.loading) return;
    set((s) => ({ byVault: { ...s.byVault, [vaultId]: startEntry(existing, vaultId) } }));
    await runAudit(vaultId, client, set);
  },

  async refresh(vaultId, client) {
    const existing = get().byVault[vaultId];
    if (existing?.loading) return;
    set((s) => ({ byVault: { ...s.byVault, [vaultId]: startEntry(existing, vaultId) } }));
    await runAudit(vaultId, client, set);
  },

  clear(vaultId) {
    set((s) => {
      if (!(vaultId in s.byVault)) return s;
      const { [vaultId]: _removed, ...rest } = s.byVault;
      return { byVault: rest };
    });
  },

  set(vaultId, result) {
    set((s) => ({
      byVault: {
        ...s.byVault,
        [vaultId]: {
          vaultId,
          result,
          loading: false,
          error: null,
          lastCheckedAt: Date.now(),
        },
      },
    }));
  },
}));
