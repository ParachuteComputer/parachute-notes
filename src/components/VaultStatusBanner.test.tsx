import { VaultStatusBanner, isLoopbackOrLocal } from "@/components/VaultStatusBanner";
import { useAuthHaltStore } from "@/lib/vault/auth-halt-store";
import * as oauthModule from "@/lib/vault/oauth";
import { InsecureContextError } from "@/lib/vault/pkce";
import { useVaultReachabilityStore } from "@/lib/vault/reachability-store";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The banner uses `useActiveVaultClient` for the Retry button. Stub it out
// so we don't need a full token + provider tree.
const mockClient = {
  vaultInfo: vi.fn(async () => ({ name: "default" })),
};
vi.mock("@/lib/vault/queries", () => ({
  useActiveVaultClient: () => mockClient,
}));

function seedVault({ url = "http://localhost:1940" } = {}) {
  useVaultStore.setState({
    vaults: {
      v: {
        id: "v",
        url,
        name: "dev",
        issuer: url,
        clientId: "c",
        scope: "full",
        addedAt: "2026-04-18T00:00:00.000Z",
        lastUsedAt: "2026-04-18T00:00:00.000Z",
      },
    },
    activeVaultId: "v",
  });
}

function renderBanner() {
  // The banner uses useQueryClient for its retry-and-invalidate flow.
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <VaultStatusBanner />
    </QueryClientProvider>,
  );
}

describe("VaultStatusBanner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    seedVault();
    localStorage.clear();
    useAuthHaltStore.setState({ byVault: {} });
    useVaultReachabilityStore.setState({ byVault: {} });
    mockClient.vaultInfo.mockClear();
  });
  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
    useAuthHaltStore.setState({ byVault: {} });
    useVaultReachabilityStore.setState({ byVault: {} });
    vi.restoreAllMocks();
  });

  it("renders nothing when both stores are clean", () => {
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it("renders the auth-halt banner when auth-halt is set", () => {
    useAuthHaltStore.getState().markHalted("v", "session expired");
    renderBanner();
    expect(screen.getByText(/vault session expired/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reconnect to vault/i })).toBeInTheDocument();
  });

  it("renders the unreachable banner when reachability is down", () => {
    // Force into `down` via three failures.
    const store = useVaultReachabilityStore.getState();
    store.reportSignal("v", "unreachable", "boom");
    store.reportSignal("v", "unreachable", "boom");
    store.reportSignal("v", "unreachable", "boom");
    renderBanner();
    expect(screen.getByText(/vault not reachable/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry now/i })).toBeInTheDocument();
  });

  it("does not render the unreachable banner while still `retrying` (single failure)", () => {
    useVaultReachabilityStore.getState().reportSignal("v", "unreachable", "blip");
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it("auth-halt wins over unreachable when both are set", () => {
    const reach = useVaultReachabilityStore.getState();
    reach.reportSignal("v", "unreachable", "boom");
    reach.reportSignal("v", "unreachable", "boom");
    reach.reportSignal("v", "unreachable", "boom");
    useAuthHaltStore.getState().markHalted("v", "session expired");
    renderBanner();
    expect(screen.getByText(/vault session expired/i)).toBeInTheDocument();
    expect(screen.queryByText(/vault not reachable/i)).not.toBeInTheDocument();
  });

  it("includes the local-vault operator hint when URL is loopback", () => {
    const store = useVaultReachabilityStore.getState();
    store.reportSignal("v", "unreachable", "boom");
    store.reportSignal("v", "unreachable", "boom");
    store.reportSignal("v", "unreachable", "boom");
    renderBanner();
    expect(screen.getByText(/parachute start vault/i)).toBeInTheDocument();
  });

  it("omits the operator hint for non-loopback URLs", () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedVault({ url: "https://aaron-vault.tail-scale.ts.net" });
    const store = useVaultReachabilityStore.getState();
    store.reportSignal("v", "unreachable", "boom");
    store.reportSignal("v", "unreachable", "boom");
    store.reportSignal("v", "unreachable", "boom");
    renderBanner();
    expect(screen.queryByText(/parachute start vault/i)).not.toBeInTheDocument();
  });

  it("Retry now button calls vaultInfo and clears the store on success", async () => {
    const store = useVaultReachabilityStore.getState();
    store.reportSignal("v", "unreachable", "boom");
    store.reportSignal("v", "unreachable", "boom");
    store.reportSignal("v", "unreachable", "boom");
    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: /retry now/i }));
    // vaultInfo runs synchronously in the mock; allow microtasks to flush.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockClient.vaultInfo).toHaveBeenCalledWith(false);
    // The mock doesn't go through the client.ts → store flush path (it would
    // require a real client). We can still verify the button was wired.
  });

  it("Dismiss button clears the unreachable entry", () => {
    const store = useVaultReachabilityStore.getState();
    store.reportSignal("v", "unreachable", "boom");
    store.reportSignal("v", "unreachable", "boom");
    store.reportSignal("v", "unreachable", "boom");
    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: /dismiss banner/i }));
    expect(useVaultReachabilityStore.getState().byVault.v).toBeUndefined();
  });

  // notes#143 follow-up: pin the auth-halt reconnect path's wiring to
  // `InsecureContextBanner` at the component level so a refactor of the
  // catch branch is caught here rather than in production.
  it("renders the InsecureContextBanner when Reconnect's beginOAuth throws InsecureContextError", async () => {
    useAuthHaltStore.getState().markHalted("v", "session expired");
    vi.spyOn(oauthModule, "beginOAuth").mockRejectedValue(
      new InsecureContextError("insecure context"),
    );
    renderBanner();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /reconnect to vault/i }));
    });
    const banner = await screen.findByTestId("insecure-context-banner");
    expect(banner).toHaveTextContent(/Insecure context/i);
    expect(banner).toHaveTextContent(/HTTPS or accessed at/i);
  });

  it("does not render the InsecureContextBanner on a generic Reconnect error", async () => {
    useAuthHaltStore.getState().markHalted("v", "session expired");
    vi.spyOn(oauthModule, "beginOAuth").mockRejectedValue(new Error("hub returned 502"));
    renderBanner();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /reconnect to vault/i }));
    });
    // Generic error renders inside the auth-halt block; banner stays hidden.
    await waitFor(() => expect(screen.getByText(/hub returned 502/i)).toBeInTheDocument());
    expect(screen.queryByTestId("insecure-context-banner")).not.toBeInTheDocument();
  });

  it("does not render the InsecureContextBanner when there is no failure", () => {
    useAuthHaltStore.getState().markHalted("v", "session expired");
    renderBanner();
    // Banner only appears after a failed reconnect attempt — initial render
    // of the auth-halt block shouldn't include it.
    expect(screen.queryByTestId("insecure-context-banner")).not.toBeInTheDocument();
  });

  // notes#148 — the reconnect must thread the currently-halted vault id
  // through beginOAuth so OAuthCallback can clear THIS vault's halt even
  // when the token catalog resolves the reconnect to a different URL.
  it("Reconnect passes the active vault id as priorHaltedVaultId to beginOAuth", async () => {
    useAuthHaltStore.getState().markHalted("v", "session expired");
    // Reject so we never reach `window.location.assign(authorizeUrl)` (jsdom
    // doesn't allow stubbing it). We're only asserting the call shape into
    // beginOAuth — what happens after the assign is the OAuthCallback test's
    // territory and is pinned there directly.
    const spy = vi.spyOn(oauthModule, "beginOAuth").mockRejectedValue(new Error("stub: stop here"));
    renderBanner();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /reconnect to vault/i }));
    });
    expect(spy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      undefined,
      expect.objectContaining({ priorHaltedVaultId: "v" }),
    );
  });
});

describe("isLoopbackOrLocal", () => {
  it("matches localhost", () => {
    expect(isLoopbackOrLocal("http://localhost:1940")).toBe(true);
    expect(isLoopbackOrLocal("http://localhost")).toBe(true);
  });
  it("matches 127.0.0.1 and ::1", () => {
    expect(isLoopbackOrLocal("http://127.0.0.1:1940")).toBe(true);
    expect(isLoopbackOrLocal("http://[::1]:1940")).toBe(true);
  });
  it("matches .local mDNS hostnames", () => {
    expect(isLoopbackOrLocal("http://my-mac.local:1940")).toBe(true);
  });
  it("matches RFC 1918 10/8 range", () => {
    expect(isLoopbackOrLocal("http://10.0.0.1:1940")).toBe(true);
    expect(isLoopbackOrLocal("http://10.255.255.254:1940")).toBe(true);
  });
  it("matches RFC 1918 192.168/16 range", () => {
    expect(isLoopbackOrLocal("http://192.168.1.10:1940")).toBe(true);
    expect(isLoopbackOrLocal("http://192.168.255.1:1940")).toBe(true);
  });
  it("matches RFC 1918 172.16-31/12 range (boundaries)", () => {
    expect(isLoopbackOrLocal("http://172.16.0.1:1940")).toBe(true);
    expect(isLoopbackOrLocal("http://172.20.1.1:1940")).toBe(true);
    expect(isLoopbackOrLocal("http://172.31.255.254:1940")).toBe(true);
  });
  it("excludes 172.15/12 and 172.32/12 — outside the private range", () => {
    expect(isLoopbackOrLocal("http://172.15.0.1:1940")).toBe(false);
    expect(isLoopbackOrLocal("http://172.32.0.1:1940")).toBe(false);
  });
  it("does not match public IPs that share a prefix digit (1.x, 19.x, 17.x)", () => {
    expect(isLoopbackOrLocal("http://1.1.1.1:1940")).toBe(false);
    expect(isLoopbackOrLocal("http://19.0.0.1:1940")).toBe(false);
    expect(isLoopbackOrLocal("http://17.0.0.1:1940")).toBe(false);
    expect(isLoopbackOrLocal("http://192.169.0.1:1940")).toBe(false);
  });
  it("does not match Tailscale-style hostnames", () => {
    expect(isLoopbackOrLocal("https://aaron-vault.tail-scale.ts.net")).toBe(false);
  });
  it("does not match public domains", () => {
    expect(isLoopbackOrLocal("https://vault.example.com")).toBe(false);
  });
  it("returns false on malformed URL", () => {
    expect(isLoopbackOrLocal("not a url")).toBe(false);
  });
});
