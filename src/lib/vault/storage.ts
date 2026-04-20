import type { PendingOAuthState, ServicesCatalog, StoredToken, VaultRecord } from "./types";

const VAULTS_KEY = "lens:vaults";
const ACTIVE_KEY = "lens:active_vault";
const TOKEN_PREFIX = "lens:token:";
const SERVICES_PREFIX = "lens:services:";
const PENDING_OAUTH_KEY = "lens:oauth:pending";

function read<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (e.g. SSR or blocked by privacy mode) — best-effort only
  }
}

export function loadVaults(): Record<string, VaultRecord> {
  return read<Record<string, VaultRecord>>(localStorage, VAULTS_KEY) ?? {};
}

export function saveVaults(vaults: Record<string, VaultRecord>): void {
  write(localStorage, VAULTS_KEY, vaults);
}

export function loadActiveVaultId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function saveActiveVaultId(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(ACTIVE_KEY);
    else localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // storage unavailable — best-effort only
  }
}

export function loadToken(vaultId: string): StoredToken | null {
  return read<StoredToken>(localStorage, TOKEN_PREFIX + vaultId);
}

export function saveToken(vaultId: string, token: StoredToken): void {
  write(localStorage, TOKEN_PREFIX + vaultId, token);
}

export function deleteToken(vaultId: string): void {
  try {
    localStorage.removeItem(TOKEN_PREFIX + vaultId);
  } catch {
    // storage unavailable — best-effort only
  }
}

export function loadServicesCatalog(vaultId: string): ServicesCatalog | null {
  return read<ServicesCatalog>(localStorage, SERVICES_PREFIX + vaultId);
}

export function saveServicesCatalog(vaultId: string, catalog: ServicesCatalog): void {
  write(localStorage, SERVICES_PREFIX + vaultId, catalog);
}

export function deleteServicesCatalog(vaultId: string): void {
  try {
    localStorage.removeItem(SERVICES_PREFIX + vaultId);
  } catch {
    // storage unavailable — best-effort only
  }
}

export function loadPendingOAuth(): PendingOAuthState | null {
  return read<PendingOAuthState>(sessionStorage, PENDING_OAUTH_KEY);
}

export function savePendingOAuth(state: PendingOAuthState): void {
  write(sessionStorage, PENDING_OAUTH_KEY, state);
}

export function clearPendingOAuth(): void {
  try {
    sessionStorage.removeItem(PENDING_OAUTH_KEY);
  } catch {
    // storage unavailable — best-effort only
  }
}
