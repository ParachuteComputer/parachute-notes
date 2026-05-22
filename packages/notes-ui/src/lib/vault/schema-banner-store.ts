import { create } from "zustand";

// Per-vault dismissal state for the schema-audit connect-time banner
// (notes#129). When the audit comes back `!ok` and the user dismisses,
// we want it to stay dismissed across reloads — so this lives in
// localStorage. The schema-audit result itself is volatile (re-runs on
// every mount or vault switch) and lives in `schema-audit-store.ts`.
//
// Mirrors `auth-halt-store.ts` shape: per-vault entries, persisted to
// localStorage under a fixed prefix, cross-tab synced via the storage
// event (cross-tab-sync.ts dispatches reloadFromStorage for the right
// prefix).

const DISMISSED_PREFIX = "notes:schema-banner-dismissed:";

interface SchemaBannerState {
  dismissedByVault: Record<string, boolean>;
  dismiss: (vaultId: string) => void;
  // Used after a successful fix: clear so a future re-audit that surfaces
  // a NEW misalignment (e.g. user edited the tag manually in vault) re-
  // raises the banner.
  clearDismissed: (vaultId: string) => void;
  reloadFromStorage: () => void;
}

function readAllFromStorage(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (typeof localStorage === "undefined") return out;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(DISMISSED_PREFIX)) continue;
      const vaultId = key.slice(DISMISSED_PREFIX.length);
      if (vaultId) out[vaultId] = true;
    }
  } catch {
    // localStorage unavailable (privacy mode) — best-effort.
  }
  return out;
}

export const useSchemaBannerStore = create<SchemaBannerState>((set) => ({
  dismissedByVault: readAllFromStorage(),

  dismiss(vaultId) {
    try {
      localStorage.setItem(DISMISSED_PREFIX + vaultId, "1");
    } catch {
      // Best-effort.
    }
    set((s) => ({ dismissedByVault: { ...s.dismissedByVault, [vaultId]: true } }));
  },

  clearDismissed(vaultId) {
    try {
      localStorage.removeItem(DISMISSED_PREFIX + vaultId);
    } catch {
      // Best-effort.
    }
    set((s) => {
      if (!(vaultId in s.dismissedByVault)) return s;
      const { [vaultId]: _removed, ...rest } = s.dismissedByVault;
      return { dismissedByVault: rest };
    });
  },

  reloadFromStorage() {
    set({ dismissedByVault: readAllFromStorage() });
  },
}));

export const SCHEMA_BANNER_KEY_PREFIX = DISMISSED_PREFIX;
