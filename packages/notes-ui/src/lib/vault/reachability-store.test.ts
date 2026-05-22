import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BACKOFF_MS_BY_INDEX,
  DOWN_THRESHOLD,
  useVaultReachabilityStore,
} from "./reachability-store";

describe("useVaultReachabilityStore", () => {
  beforeEach(() => {
    useVaultReachabilityStore.setState({ byVault: {} });
  });
  afterEach(() => {
    useVaultReachabilityStore.setState({ byVault: {} });
  });

  it("starts with no entry per vault", () => {
    expect(useVaultReachabilityStore.getState().byVault.v1).toBeUndefined();
  });

  it("first failure transitions to retrying with backoff", () => {
    useVaultReachabilityStore.getState().reportSignal("v1", "unreachable", "ECONNREFUSED");
    const entry = useVaultReachabilityStore.getState().byVault.v1;
    expect(entry?.state).toBe("retrying");
    expect(entry?.consecutiveFailures).toBe(1);
    expect(entry?.lastErrorReason).toBe("ECONNREFUSED");
    // First backoff index hits the first slot (1s).
    expect(entry?.nextProbeAt).not.toBeNull();
    expect(entry?.backoffIndex).toBe(1);
  });

  it("crosses the DOWN_THRESHOLD after consecutive failures", () => {
    const store = useVaultReachabilityStore.getState();
    for (let i = 0; i < DOWN_THRESHOLD; i++) {
      store.reportSignal("v1", "unreachable", "HTTP 502");
    }
    const entry = useVaultReachabilityStore.getState().byVault.v1;
    expect(entry?.state).toBe("down");
    expect(entry?.consecutiveFailures).toBe(DOWN_THRESHOLD);
  });

  it("healthy signal resets to healthy from retrying", () => {
    const store = useVaultReachabilityStore.getState();
    store.reportSignal("v1", "unreachable", "HTTP 503");
    expect(useVaultReachabilityStore.getState().byVault.v1?.state).toBe("retrying");
    store.reportSignal("v1", "healthy");
    expect(useVaultReachabilityStore.getState().byVault.v1).toBeUndefined();
  });

  it("healthy signal resets to healthy from down", () => {
    const store = useVaultReachabilityStore.getState();
    for (let i = 0; i < DOWN_THRESHOLD; i++) {
      store.reportSignal("v1", "unreachable", "boom");
    }
    expect(useVaultReachabilityStore.getState().byVault.v1?.state).toBe("down");
    store.reportSignal("v1", "healthy");
    expect(useVaultReachabilityStore.getState().byVault.v1).toBeUndefined();
  });

  it("healthy on already-healthy vault is a no-op (stable object)", () => {
    const before = useVaultReachabilityStore.getState().byVault;
    useVaultReachabilityStore.getState().reportSignal("v1", "healthy");
    expect(useVaultReachabilityStore.getState().byVault).toBe(before);
  });

  it("tracks multiple vaults independently", () => {
    const store = useVaultReachabilityStore.getState();
    store.reportSignal("v1", "unreachable", "v1 down");
    store.reportSignal("v2", "unreachable", "v2 down");
    store.reportSignal("v2", "unreachable", "v2 still down");
    expect(useVaultReachabilityStore.getState().byVault.v1?.consecutiveFailures).toBe(1);
    expect(useVaultReachabilityStore.getState().byVault.v2?.consecutiveFailures).toBe(2);
    store.reportSignal("v1", "healthy");
    expect(useVaultReachabilityStore.getState().byVault.v1).toBeUndefined();
    expect(useVaultReachabilityStore.getState().byVault.v2?.consecutiveFailures).toBe(2);
  });

  it("backoff index extends with each failure (within bounds)", () => {
    const store = useVaultReachabilityStore.getState();
    for (let i = 1; i <= BACKOFF_MS_BY_INDEX.length + 2; i++) {
      store.reportSignal("v1", "unreachable", `fail ${i}`);
    }
    const entry = useVaultReachabilityStore.getState().byVault.v1;
    // backoffIndex keeps incrementing even when nextProbeAt's delay is capped.
    expect(entry?.backoffIndex).toBe(BACKOFF_MS_BY_INDEX.length + 2);
    // The probe time picks the capped delay (30s) when index exceeds the
    // backoff array. We can't assert exact time but it should be ≥ the cap.
    const lastBackoff = BACKOFF_MS_BY_INDEX[BACKOFF_MS_BY_INDEX.length - 1] ?? 30_000;
    expect((entry?.nextProbeAt ?? 0) - (entry?.lastErrorAt ?? 0)).toBeGreaterThanOrEqual(
      lastBackoff,
    );
  });

  it("resetToHealthy is a no-op when no entry exists", () => {
    useVaultReachabilityStore.getState().resetToHealthy("v1");
    expect(useVaultReachabilityStore.getState().byVault.v1).toBeUndefined();
  });

  it("resetToHealthy clears a down entry", () => {
    const store = useVaultReachabilityStore.getState();
    for (let i = 0; i < DOWN_THRESHOLD; i++) {
      store.reportSignal("v1", "unreachable", "boom");
    }
    expect(useVaultReachabilityStore.getState().byVault.v1?.state).toBe("down");
    store.resetToHealthy("v1");
    expect(useVaultReachabilityStore.getState().byVault.v1).toBeUndefined();
  });
});
