import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTH_HALT_KEY_PREFIX, useAuthHaltStore } from "./auth-halt-store";

describe("useAuthHaltStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthHaltStore.setState({ byVault: {} });
  });

  afterEach(() => {
    localStorage.clear();
    useAuthHaltStore.setState({ byVault: {} });
  });

  it("markHalted persists to localStorage and updates the store", () => {
    useAuthHaltStore.getState().markHalted("v1", "session expired");
    const entry = useAuthHaltStore.getState().byVault.v1;
    expect(entry?.vaultId).toBe("v1");
    expect(entry?.reason).toBe("session expired");

    const raw = localStorage.getItem(`${AUTH_HALT_KEY_PREFIX}v1`);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.vaultId).toBe("v1");
    expect(parsed.reason).toBe("session expired");
  });

  it("clearHalt removes the entry from both store and localStorage", () => {
    useAuthHaltStore.getState().markHalted("v1", "expired");
    expect(useAuthHaltStore.getState().byVault.v1).toBeDefined();

    useAuthHaltStore.getState().clearHalt("v1");
    expect(useAuthHaltStore.getState().byVault.v1).toBeUndefined();
    expect(localStorage.getItem(`${AUTH_HALT_KEY_PREFIX}v1`)).toBeNull();
  });

  it("tracks multiple vaults independently", () => {
    useAuthHaltStore.getState().markHalted("v1", "v1 expired");
    useAuthHaltStore.getState().markHalted("v2", "v2 expired");

    expect(useAuthHaltStore.getState().byVault.v1?.reason).toBe("v1 expired");
    expect(useAuthHaltStore.getState().byVault.v2?.reason).toBe("v2 expired");

    useAuthHaltStore.getState().clearHalt("v1");
    expect(useAuthHaltStore.getState().byVault.v1).toBeUndefined();
    expect(useAuthHaltStore.getState().byVault.v2?.reason).toBe("v2 expired");
  });

  it("reloadFromStorage picks up entries written by another tab", () => {
    // Simulate a sibling tab writing the halt directly.
    const entry = { vaultId: "v1", reason: "from other tab", at: Date.now() };
    localStorage.setItem(`${AUTH_HALT_KEY_PREFIX}v1`, JSON.stringify(entry));

    expect(useAuthHaltStore.getState().byVault.v1).toBeUndefined();
    useAuthHaltStore.getState().reloadFromStorage();
    expect(useAuthHaltStore.getState().byVault.v1?.reason).toBe("from other tab");
  });

  it("ignores malformed entries during reloadFromStorage", () => {
    localStorage.setItem(`${AUTH_HALT_KEY_PREFIX}v1`, "{ not json");
    useAuthHaltStore.getState().reloadFromStorage();
    expect(useAuthHaltStore.getState().byVault.v1).toBeUndefined();
  });
});
