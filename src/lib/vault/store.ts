import { create } from "zustand";
import {
  deleteServicesCatalog,
  deleteToken,
  loadActiveVaultId,
  loadToken,
  loadVaults,
  saveActiveVaultId,
  saveToken,
  saveVaults,
} from "./storage";
import type { StoredToken, VaultRecord } from "./types";
import { vaultIdFromUrl } from "./url";

export interface VaultStoreState {
  vaults: Record<string, VaultRecord>;
  activeVaultId: string | null;
  addVault: (
    input: Omit<VaultRecord, "id" | "addedAt" | "lastUsedAt">,
    token: StoredToken,
  ) => string;
  removeVault: (id: string) => void;
  setActiveVault: (id: string | null) => void;
  touchActive: (id: string) => void;
  getToken: (id: string) => StoredToken | null;
  getActiveVault: () => VaultRecord | null;
  getActiveToken: () => StoredToken | null;
}

export const useVaultStore = create<VaultStoreState>((set, get) => ({
  vaults: loadVaults(),
  activeVaultId: loadActiveVaultId(),

  addVault(input, token) {
    const id = vaultIdFromUrl(input.url);
    const now = new Date().toISOString();
    const record: VaultRecord = { ...input, id, addedAt: now, lastUsedAt: now };

    const nextVaults = { ...get().vaults, [id]: record };
    saveVaults(nextVaults);
    saveToken(id, token);
    saveActiveVaultId(id);
    set({ vaults: nextVaults, activeVaultId: id });
    return id;
  },

  removeVault(id) {
    const { [id]: _removed, ...rest } = get().vaults;
    saveVaults(rest);
    deleteToken(id);
    deleteServicesCatalog(id);
    const nextActive =
      get().activeVaultId === id ? (Object.keys(rest)[0] ?? null) : get().activeVaultId;
    saveActiveVaultId(nextActive);
    set({ vaults: rest, activeVaultId: nextActive });
  },

  setActiveVault(id) {
    saveActiveVaultId(id);
    set({ activeVaultId: id });
  },

  touchActive(id) {
    const existing = get().vaults[id];
    if (!existing) return;
    const updated = { ...existing, lastUsedAt: new Date().toISOString() };
    const nextVaults = { ...get().vaults, [id]: updated };
    saveVaults(nextVaults);
    set({ vaults: nextVaults });
  },

  getToken(id) {
    return loadToken(id);
  },

  getActiveVault() {
    const { vaults, activeVaultId } = get();
    return activeVaultId ? (vaults[activeVaultId] ?? null) : null;
  },

  getActiveToken() {
    const { activeVaultId } = get();
    return activeVaultId ? loadToken(activeVaultId) : null;
  },
}));
