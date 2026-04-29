import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTH_HALT_KEY_PREFIX, useAuthHaltStore } from "./auth-halt-store";
import { useCrossTabVaultSync } from "./cross-tab-sync";
import { ACTIVE_KEY, VAULTS_KEY } from "./storage";
import { useVaultStore } from "./store";
import type { VaultRecord } from "./types";

function makeVault(id: string, overrides: Partial<VaultRecord> = {}): VaultRecord {
  return {
    id,
    url: `http://localhost:1940/${id}`,
    name: id,
    issuer: "http://localhost:1939",
    tokenEndpoint: "http://localhost:1939/oauth/token",
    clientId: "client-123",
    scope: "vault:read vault:write",
    addedAt: "2026-04-25T00:00:00Z",
    lastUsedAt: "2026-04-25T00:00:00Z",
    ...overrides,
  };
}

// Storage events fire in *other* tabs, never the writing tab — so jsdom won't
// emit one on `localStorage.setItem`. These tests dispatch the event manually
// (the same shape the browser would deliver from a sibling tab).
function fireStorageEvent(key: string | null, newValue: string | null): void {
  window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
}

describe("useCrossTabVaultSync", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useAuthHaltStore.setState({ byVault: {} });
  });

  afterEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useAuthHaltStore.setState({ byVault: {} });
  });

  it("picks up active-vault changes written by another tab", () => {
    const v1 = makeVault("v1");
    // Sibling tab wrote both the vault map and the active id directly.
    localStorage.setItem(VAULTS_KEY, JSON.stringify({ v1 }));
    localStorage.setItem(ACTIVE_KEY, "v1");

    renderHook(() => useCrossTabVaultSync());

    expect(useVaultStore.getState().activeVaultId).toBeNull();
    fireStorageEvent(ACTIVE_KEY, "v1");
    expect(useVaultStore.getState().activeVaultId).toBe("v1");
  });

  it("picks up vault-map changes written by another tab", () => {
    const v1 = makeVault("v1");
    localStorage.setItem(VAULTS_KEY, JSON.stringify({ v1 }));

    renderHook(() => useCrossTabVaultSync());

    expect(useVaultStore.getState().vaults).toEqual({});
    fireStorageEvent(VAULTS_KEY, localStorage.getItem(VAULTS_KEY));
    expect(useVaultStore.getState().vaults).toEqual({ v1 });
  });

  it("picks up auth-halt changes for any vault id under the prefix", () => {
    const entry = { vaultId: "v1", reason: "from sibling tab", at: Date.now() };
    localStorage.setItem(`${AUTH_HALT_KEY_PREFIX}v1`, JSON.stringify(entry));

    renderHook(() => useCrossTabVaultSync());

    expect(useAuthHaltStore.getState().byVault.v1).toBeUndefined();
    fireStorageEvent(`${AUTH_HALT_KEY_PREFIX}v1`, JSON.stringify(entry));
    expect(useAuthHaltStore.getState().byVault.v1?.reason).toBe("from sibling tab");
  });

  it("handles a wholesale localStorage.clear() by reloading every mirrored slice", () => {
    // Seed the store with state, then simulate a sibling clearing storage.
    useVaultStore.setState({ vaults: { v1: makeVault("v1") }, activeVaultId: "v1" });
    useAuthHaltStore.setState({ byVault: { v1: { vaultId: "v1", reason: "stale", at: 0 } } });

    renderHook(() => useCrossTabVaultSync());
    fireStorageEvent(null, null);

    expect(useVaultStore.getState().vaults).toEqual({});
    expect(useVaultStore.getState().activeVaultId).toBeNull();
    expect(useAuthHaltStore.getState().byVault).toEqual({});
  });

  it("ignores unrelated keys", () => {
    renderHook(() => useCrossTabVaultSync());
    const before = useVaultStore.getState();
    const beforeHalt = useAuthHaltStore.getState();

    fireStorageEvent("some-other-app:setting", "value");

    expect(useVaultStore.getState()).toBe(before);
    expect(useAuthHaltStore.getState()).toBe(beforeHalt);
  });

  it("removes the listener on unmount", () => {
    const { unmount } = renderHook(() => useCrossTabVaultSync());
    unmount();

    // After unmount, dispatching a storage event must not change state.
    localStorage.setItem(ACTIVE_KEY, "v2");
    fireStorageEvent(ACTIVE_KEY, "v2");
    expect(useVaultStore.getState().activeVaultId).toBeNull();
  });
});
