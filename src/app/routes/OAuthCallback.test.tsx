import { OAuthCallback } from "@/app/routes/OAuthCallback";
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
