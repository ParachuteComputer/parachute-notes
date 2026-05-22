import { VaultStatusBanner } from "@/components/VaultStatusBanner";
import { useAuthHaltStore } from "@/lib/vault/auth-halt-store";
import { useVaultReachabilityStore } from "@/lib/vault/reachability-store";
import { saveToken } from "@/lib/vault/storage";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Integration test for notes#118: covers the load-bearing "Retry now" flow
// end-to-end through the *real* useActiveVaultClient → VaultClient →
// onReachability callback path, not the stubbed `mockClient.vaultInfo`
// used by VaultStatusBanner.test.tsx. The unit test there asserts the
// button is wired; this one regression-pins that a successful retry
// actually flushes the store and hides the banner.
//
// We deliberately do NOT `vi.mock("@/lib/vault/queries")` so that
// `useActiveVaultClient` constructs a genuine VaultClient with the real
// onReachability callback (which calls
// `useVaultReachabilityStore.getState().reportSignal`). Fetch is the
// boundary we mock — vi.stubGlobal swaps in a fake that returns whatever
// status we want.

function seedVaultWithToken() {
  useVaultStore.setState({
    vaults: {
      v: {
        id: "v",
        url: "http://localhost:1940",
        name: "dev",
        issuer: "http://localhost:1940",
        clientId: "c",
        scope: "full",
        addedAt: "2026-04-18T00:00:00.000Z",
        lastUsedAt: "2026-04-18T00:00:00.000Z",
      },
    },
    activeVaultId: "v",
  });
  // saveToken writes to localStorage under `lens:token:v` — useActiveVaultClient
  // reads this synchronously via loadToken to decide whether to construct
  // a VaultClient.
  saveToken("v", { accessToken: "test-token", scope: "full", vault: "default" });
}

function forceDown() {
  // The reachability store promotes to `down` on the third consecutive
  // failure. Simulate that without involving a real fetch — this test
  // doesn't care about the path-into-`down`, only the path-out-of-`down`.
  const store = useVaultReachabilityStore.getState();
  store.reportSignal("v", "unreachable", "boom");
  store.reportSignal("v", "unreachable", "boom");
  store.reportSignal("v", "unreachable", "boom");
}

function renderBanner() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <VaultStatusBanner />
    </QueryClientProvider>,
  );
}

describe("VaultStatusBanner — Retry now integration", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthHaltStore.setState({ byVault: {} });
    useVaultReachabilityStore.setState({ byVault: {} });
    seedVaultWithToken();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
    useAuthHaltStore.setState({ byVault: {} });
    useVaultReachabilityStore.setState({ byVault: {} });
  });

  it("Retry now → 4xx response flushes store via real onReachability, banner disappears", async () => {
    // 4xx counts as "vault is answering" per client.ts:onReachability —
    // the request still throws (VaultAuthError on 401), but the *response*
    // arrives, which is the signal reachability cares about. This shape
    // matches the real recovery path: vault came back, auth still needs
    // refreshing, but the network/server is reachable again.
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchImpl);

    forceDown();
    renderBanner();

    // Verify down state surfaced.
    expect(screen.getByText(/vault not reachable/i)).toBeInTheDocument();
    expect(useVaultReachabilityStore.getState().byVault.v?.state).toBe("down");

    fireEvent.click(screen.getByRole("button", { name: /retry now/i }));

    // The retry handler awaits vaultInfo(); under the hood:
    //   VaultClient.request("/api/vault?...") → fetch resolves with 401
    //   → onReachability("healthy") fires (4xx = vault is answering)
    //   → store.reportSignal("v", "healthy") deletes the byVault entry
    //   → banner re-renders with no `reach` entry → returns null
    //   The vaultInfo() promise itself rejects with VaultAuthError, caught
    //   by the banner's try/finally — that's by design.
    await waitFor(() => {
      expect(useVaultReachabilityStore.getState().byVault.v).toBeUndefined();
    });
    expect(screen.queryByText(/vault not reachable/i)).not.toBeInTheDocument();

    // Confirm the real fetch boundary was hit (i.e. we didn't accidentally
    // mock useActiveVaultClient out — that's what notes#118 was filed to
    // prevent regressing).
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = fetchImpl.mock.calls[0]?.[0];
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(String(url)).toContain("/api/vault");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("Retry now → 5xx response keeps the banner up, store still down", async () => {
    // Sanity-check the other branch: 502 means vault still unreachable,
    // banner stays, store stays `down`, backoff index extends.
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response("Bad Gateway", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchImpl);

    forceDown();
    const beforeIndex = useVaultReachabilityStore.getState().byVault.v?.backoffIndex ?? 0;
    renderBanner();

    fireEvent.click(screen.getByRole("button", { name: /retry now/i }));

    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
    // Still down; backoff extended.
    const entry = useVaultReachabilityStore.getState().byVault.v;
    expect(entry?.state).toBe("down");
    expect(entry?.backoffIndex).toBeGreaterThan(beforeIndex);
    expect(screen.getByText(/vault not reachable/i)).toBeInTheDocument();
  });

  it("Retry now → 200 response flushes store, banner disappears", async () => {
    // The happy-path shape: vault is back. Distinct from the 401 case
    // because the request actually resolves (no thrown error), but the
    // observable outcome — onReachability("healthy") → store flush →
    // banner unmounts — is the same. This pins both response paths.
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ name: "default" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchImpl);

    forceDown();
    renderBanner();

    fireEvent.click(screen.getByRole("button", { name: /retry now/i }));

    await waitFor(() => {
      expect(useVaultReachabilityStore.getState().byVault.v).toBeUndefined();
    });
    expect(screen.queryByText(/vault not reachable/i)).not.toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
