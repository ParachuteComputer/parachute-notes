import { OAuthCallback } from "@/app/routes/OAuthCallback";
import { useAuthHaltStore } from "@/lib/vault/auth-halt-store";
import { savePendingOAuth } from "@/lib/vault/storage";
import { useVaultStore } from "@/lib/vault/store";
import type { PendingOAuthState } from "@/lib/vault/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pending: PendingOAuthState = {
  issuerUrl: "http://localhost:1940",
  issuer: "http://localhost:1940",
  tokenEndpoint: "http://localhost:1940/oauth/token",
  clientId: "client-123",
  codeVerifier: "verifier-abc",
  state: "state-xyz",
  redirectUri: "http://localhost:3000/oauth/callback",
  scope: "vault:read vault:write",
  startedAt: "2026-05-11T00:00:00.000Z",
};

function mockTokenResponse(response: { ok?: boolean; status?: number; body: string }) {
  const impl = vi.fn<typeof fetch>(async () => {
    return {
      ok: response.ok ?? false,
      status: response.status ?? 401,
      json: async () => JSON.parse(response.body),
      text: async () => response.body,
    } as Response;
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

function renderCallback() {
  return render(
    <MemoryRouter initialEntries={["/oauth/callback?code=auth-code&state=state-xyz"]}>
      <Routes>
        <Route path="/oauth/callback" element={<OAuthCallback />} />
        <Route path="/add" element={<div>Add vault page</div>} />
        <Route path="/" element={<div>Home page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("OAuthCallback pending-approval rendering", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders an 'Open approval page' link when the hub includes approve_url", async () => {
    savePendingOAuth(pending);
    const approveUrl = "http://localhost:1940/admin/approve-client/client-123";
    mockTokenResponse({
      body: JSON.stringify({
        error: "invalid_client",
        error_description: "client is registered but has not been approved by the hub operator",
        approve_url: approveUrl,
        cli_alternative: "parachute auth approve-client client-123",
      }),
    });

    renderCallback();

    const link = await screen.findByRole("link", { name: /open approval page/i });
    expect(link).toHaveAttribute("href", approveUrl);
    expect(link).toHaveAttribute("target", "_blank");
    // Pinned exactly so a future edit dropping noreferrer fails loud.
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/your hub admin needs to approve this app/i)).toBeInTheDocument();
    // CLI alternative is intentionally NOT surfaced — the web approval path
    // is the path now.
    expect(screen.queryByText(/parachute auth approve-client/)).not.toBeInTheDocument();
    // Does NOT show the raw "Connection failed" error UI.
    expect(screen.queryByText(/connection failed/i)).not.toBeInTheDocument();
  });

  it("'Retry now' navigates to /add (single-use code: reload would re-redeem and 4xx)", async () => {
    // Single-use authorization codes (RFC 6749 §4.1.2) mean a naive
    // reload-with-same-params strategy reuses the already-redeemed code and
    // lands the user on the generic "Connection failed" screen. Pin the
    // navigate-to-/add behavior so a future change can't accidentally
    // re-introduce the reload pattern.
    savePendingOAuth(pending);
    const approveUrl = "http://localhost:1940/admin/approve-client/client-123";
    mockTokenResponse({
      body: JSON.stringify({
        error: "invalid_client",
        error_description: "client pending approval",
        approve_url: approveUrl,
      }),
    });

    renderCallback();

    const retry = await screen.findByRole("button", { name: /retry now/i });
    fireEvent.click(retry);

    await waitFor(() => {
      expect(screen.getByText(/add vault page/i)).toBeInTheDocument();
    });
  });

  it("falls back to the generic 'Connection failed' UI for non-pending-approval errors", async () => {
    savePendingOAuth(pending);
    mockTokenResponse({
      body: JSON.stringify({
        error: "invalid_grant",
        error_description: "authorization code expired",
      }),
      status: 400,
    });

    renderCallback();

    await waitFor(() => {
      expect(screen.getByText(/connection failed/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/waiting for hub approval/i)).not.toBeInTheDocument();
  });
});

// Mints a successful /oauth/token response with the given catalog + vault
// claim. Distinct from `mockTokenResponse` above (which always returns a
// non-ok body) so the success-path tests below get a real exchange.
function mockSuccessfulTokenResponse(body: {
  vault: string;
  services?: Record<string, { url: string; version?: string } | undefined>;
}) {
  const payload = {
    access_token: "tok_test",
    token_type: "bearer",
    scope: "vault:read vault:write",
    vault: body.vault,
    expires_in: 3600,
    services: body.services,
  };
  const impl = vi.fn<typeof fetch>(async () => {
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as Response;
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

describe("OAuthCallback vault URL resolution (notes#121)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it("uses services['vault:<name>'].url when the per-vault key matches the token's vault claim", async () => {
    savePendingOAuth(pending);
    // Hub fronting three vaults — boulder, gitcoin, techne. The token names
    // boulder; the catalog has per-vault entries for all three plus the
    // legacy collapsed `vault` pointing at the first. The new resolution
    // logic should pick boulder, not the collapsed default.
    mockSuccessfulTokenResponse({
      vault: "boulder",
      services: {
        vault: { url: "http://hub.example/vault/gitcoin" },
        "vault:boulder": { url: "http://hub.example/vault/boulder" },
        "vault:gitcoin": { url: "http://hub.example/vault/gitcoin" },
        "vault:techne": { url: "http://hub.example/vault/techne" },
      },
    });

    renderCallback();

    await waitFor(() => {
      const vaults = Object.values(useVaultStore.getState().vaults);
      expect(vaults).toHaveLength(1);
      expect(vaults[0]?.url).toBe("http://hub.example/vault/boulder");
    });
  });

  it("falls back to services.vault.url when the per-vault key is missing (single-vault hub)", async () => {
    savePendingOAuth(pending);
    // Pre-#247 hub shape (or a single-vault hub on the post-#247 build that
    // doesn't bother emitting per-vault keys): only the collapsed `vault`
    // entry exists. The vault claim names "default" but there's no
    // `vault:default` key — fall through to the collapsed entry.
    mockSuccessfulTokenResponse({
      vault: "default",
      services: {
        vault: { url: "http://hub.example/vault/default" },
      },
    });

    renderCallback();

    await waitFor(() => {
      const vaults = Object.values(useVaultStore.getState().vaults);
      expect(vaults).toHaveLength(1);
      expect(vaults[0]?.url).toBe("http://hub.example/vault/default");
    });
  });

  it("falls back to pending.issuerUrl when the token has no services catalog (standalone vault)", async () => {
    savePendingOAuth(pending);
    // A standalone vault (no hub fronting it) issues tokens without a
    // services catalog. URL resolution must fall through both lookups and
    // land on the issuer URL the user OAuthed against.
    mockSuccessfulTokenResponse({
      vault: "default",
      // services intentionally omitted.
    });

    renderCallback();

    await waitFor(() => {
      const vaults = Object.values(useVaultStore.getState().vaults);
      expect(vaults).toHaveLength(1);
      expect(vaults[0]?.url).toBe(pending.issuerUrl);
    });
  });
});

// notes#148 — the OAuth reconnect path must clear the halt for BOTH the
// new vault id AND the originally-halted vault id when the two differ. The
// hub's token catalog can resolve a vault to a different URL than what's
// currently stored (e.g. standalone-vault add → reconnected through a hub
// proxy), in which case addVault creates a new entry under a fresh id and
// the halt on the old id would otherwise be orphaned in localStorage.
describe("OAuthCallback auth-halt clearing on successful reconnect (notes#148)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useAuthHaltStore.setState({ byVault: {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useAuthHaltStore.setState({ byVault: {} });
    sessionStorage.clear();
    localStorage.clear();
  });

  it("clears the halt for the new vault id when reconnect resolves to the same URL", async () => {
    // Same-URL reconnect: new id == old id. The single clearHalt call
    // covers both. Pin so a future refactor doesn't accidentally drop the
    // baseline same-URL behavior.
    savePendingOAuth(pending);
    // No priorHaltedVaultId — this exercises the cold/same-URL path.
    // `vaultIdFromUrl("http://localhost:1940")` slugifies `:` → `_`.
    const newId = "localhost_1940";
    useAuthHaltStore.getState().markHalted(newId, "session expired");
    mockSuccessfulTokenResponse({
      vault: "default",
      services: { vault: { url: "http://localhost:1940" } },
    });

    renderCallback();

    await waitFor(() => {
      expect(useAuthHaltStore.getState().byVault[newId]).toBeUndefined();
    });
  });

  it("clears the originally-halted id when the new vault url resolves to a different id", async () => {
    // Real-world reconnect scenario Aaron hit: vault was added standalone
    // at `localhost:1940`, the user reconnects via a hub-fronted issuer,
    // and the hub returns `services.vault.url = "http://hub.example/vault/default"`.
    // addVault registers a NEW vault entry under a different id and the
    // OLD halt would otherwise survive forever in localStorage. The
    // new-vault id has no halt to clear — we have to clear the old id
    // explicitly via the priorHaltedVaultId stash.
    const oldId = "localhost_1940";
    const reconnectPending: PendingOAuthState = { ...pending, priorHaltedVaultId: oldId };
    savePendingOAuth(reconnectPending);
    useAuthHaltStore.getState().markHalted(oldId, "session expired");
    mockSuccessfulTokenResponse({
      vault: "default",
      services: { vault: { url: "http://hub.example/vault/default" } },
    });

    renderCallback();

    await waitFor(() => {
      expect(useAuthHaltStore.getState().byVault[oldId]).toBeUndefined();
    });
    // And the new vault id is the active one (vaultIdFromUrl slugifies `/`
    // and other non-word chars to `_`).
    expect(useVaultStore.getState().activeVaultId).toBe("hub.example_vault_default");
  });

  it("clears localStorage too — survives a page reload", async () => {
    // Structural test for the contract that a reconnect clears the halt
    // in *persistent* storage, not just the in-memory zustand state.
    // Without this, a reload after reconnect would re-seed the store
    // from a stale localStorage entry and the banner would reappear.
    const oldId = "localhost_1940";
    const reconnectPending: PendingOAuthState = { ...pending, priorHaltedVaultId: oldId };
    savePendingOAuth(reconnectPending);
    useAuthHaltStore.getState().markHalted(oldId, "session expired");
    expect(localStorage.getItem(`lens:auth-halt:${oldId}`)).not.toBeNull();
    mockSuccessfulTokenResponse({
      vault: "default",
      services: { vault: { url: "http://hub.example/vault/default" } },
    });

    renderCallback();

    await waitFor(() => {
      expect(localStorage.getItem(`lens:auth-halt:${oldId}`)).toBeNull();
    });
  });
});
