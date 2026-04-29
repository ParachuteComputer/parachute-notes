import type { PendingOAuthState, ServicesCatalog, StoredToken, VaultRecord } from "./types";

export const VAULTS_KEY = "lens:vaults";
export const ACTIVE_KEY = "lens:active_vault";
const TOKEN_PREFIX = "lens:token:";
const SERVICES_PREFIX = "lens:services:";
const PENDING_OAUTH_KEY = "lens:oauth:pending";
// DCR cache: hub assigns one client_id per (issuer, redirect_uri) — we only
// register once per browser/install per issuer and reuse on subsequent
// connects. Keyed by issuer origin (not vault id) because the same hub
// fronts multiple vaults under one client_id.
const DCR_PREFIX = "lens:dcr:";

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

interface CachedClientRegistration {
  clientId: string;
  redirectUri: string;
  registeredAt: string;
}

// Issuer keys are normalized to a bare origin so trailing-slash variants don't
// fork the cache. Vault-path issuers (`http://localhost:1940/vault/default`)
// keep their path because the path-component is part of identity for RFC 8414.
function normalizeIssuerKey(issuer: string): string {
  return issuer.replace(/\/+$/, "");
}

export function loadCachedClientId(issuer: string, redirectUri: string): string | null {
  const cached = read<CachedClientRegistration>(
    localStorage,
    DCR_PREFIX + normalizeIssuerKey(issuer),
  );
  if (!cached) return null;
  // Re-registering when the redirect URI changes is the safe move — hub binds
  // client_id to redirect_uri and would reject the authorize request otherwise.
  if (cached.redirectUri !== redirectUri) return null;
  return cached.clientId;
}

export function saveCachedClientId(issuer: string, redirectUri: string, clientId: string): void {
  const entry: CachedClientRegistration = {
    clientId,
    redirectUri,
    registeredAt: new Date().toISOString(),
  };
  write(localStorage, DCR_PREFIX + normalizeIssuerKey(issuer), entry);
}

export function clearCachedClientId(issuer: string): void {
  try {
    localStorage.removeItem(DCR_PREFIX + normalizeIssuerKey(issuer));
  } catch {
    // storage unavailable — best-effort only
  }
}
