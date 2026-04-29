import { create } from "zustand";

// Per-vault "this session is dead, ask the user to reconnect" marker. Set when
// the hub returns an HTTP error from /oauth/token (refresh token revoked /
// rotated past us / client deleted) or when a 401 keeps coming back even after
// a successful refresh attempt. Read by the top-level ReconnectBanner so the
// user gets a non-dismissable prompt no matter where in the app they are.
//
// Backed by localStorage so the halt survives a reload (otherwise a refresh
// would silently restart all the failing queries) and so a sibling tab can
// observe it via the storage event (#86 cross-tab sync).
const HALT_PREFIX = "lens:auth-halt:";

export interface AuthHaltEntry {
  vaultId: string;
  reason: string;
  at: number;
}

interface AuthHaltState {
  byVault: Record<string, AuthHaltEntry>;
  markHalted: (vaultId: string, reason: string) => void;
  clearHalt: (vaultId: string) => void;
  reloadFromStorage: () => void;
}

function readAllFromStorage(): Record<string, AuthHaltEntry> {
  const out: Record<string, AuthHaltEntry> = {};
  if (typeof localStorage === "undefined") return out;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(HALT_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const entry = JSON.parse(raw) as AuthHaltEntry;
        if (entry?.vaultId) out[entry.vaultId] = entry;
      } catch {
        // Malformed entry — ignore; the next markHalted will overwrite.
      }
    }
  } catch {
    // localStorage unavailable (privacy mode) — best-effort.
  }
  return out;
}

export const useAuthHaltStore = create<AuthHaltState>((set) => ({
  byVault: readAllFromStorage(),

  markHalted(vaultId, reason) {
    const entry: AuthHaltEntry = { vaultId, reason, at: Date.now() };
    try {
      localStorage.setItem(HALT_PREFIX + vaultId, JSON.stringify(entry));
    } catch {
      // Best-effort.
    }
    set((s) => ({ byVault: { ...s.byVault, [vaultId]: entry } }));
  },

  clearHalt(vaultId) {
    try {
      localStorage.removeItem(HALT_PREFIX + vaultId);
    } catch {
      // Best-effort.
    }
    set((s) => {
      if (!(vaultId in s.byVault)) return s;
      const { [vaultId]: _removed, ...rest } = s.byVault;
      return { byVault: rest };
    });
  },

  reloadFromStorage() {
    set({ byVault: readAllFromStorage() });
  },
}));

// Exported so the cross-tab listener can recognize halt-prefix keys without
// duplicating the constant.
export const AUTH_HALT_KEY_PREFIX = HALT_PREFIX;
