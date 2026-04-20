import { Home } from "@/app/routes/Home";
import { useVaultStore } from "@/lib/vault/store";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const validMetadata = {
  issuer: "http://localhost:1940",
  authorization_endpoint: "http://localhost:1940/oauth/authorize",
  token_endpoint: "http://localhost:1940/oauth/token",
  registration_endpoint: "http://localhost:1940/oauth/register",
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["S256"],
  grant_types_supported: ["authorization_code"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: ["full", "read"],
};

function mockFetchOnce(response: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  throwNetwork?: boolean;
}) {
  const impl = vi.fn<typeof fetch>(async () => {
    if (response.throwNetwork) throw new Error("network down");
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.json,
      text: async () => "",
    } as Response;
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/add" element={<div>Add form</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Home landing probe", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it("offers to connect to the detected origin when the probe succeeds", async () => {
    mockFetchOnce({ json: validMetadata });
    renderHome();

    const connect = await screen.findByRole("link", { name: /^connect$/i });
    expect(connect).toHaveAttribute(
      "href",
      `/add?url=${encodeURIComponent(window.location.origin)}`,
    );
    expect(screen.getByText(/looks like there's a vault at/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /or connect to a different vault/i })).toHaveAttribute(
      "href",
      "/add",
    );
  });

  it("falls back silently to the default CTA on network error", async () => {
    mockFetchOnce({ throwNetwork: true });
    renderHome();

    await waitFor(() =>
      expect(screen.getByRole("link", { name: /^connect a vault$/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/looks like there's a vault at/i)).not.toBeInTheDocument();
  });

  it("falls back silently on 404", async () => {
    mockFetchOnce({ ok: false, status: 404 });
    renderHome();

    await waitFor(() =>
      expect(screen.getByRole("link", { name: /^connect a vault$/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/looks like there's a vault at/i)).not.toBeInTheDocument();
  });

  it("falls back silently when metadata is invalid", async () => {
    mockFetchOnce({
      json: { ...validMetadata, code_challenge_methods_supported: ["plain"] },
    });
    renderHome();

    await waitFor(() =>
      expect(screen.getByRole("link", { name: /^connect a vault$/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/looks like there's a vault at/i)).not.toBeInTheDocument();
  });

  it("does not probe when vaults are already in storage", async () => {
    const fetchImpl = mockFetchOnce({ json: validMetadata });
    useVaultStore.setState({
      vaults: {
        existing: {
          id: "existing",
          url: "http://localhost:1940",
          name: "default",
          issuer: "http://localhost:1940",
          clientId: "c",
          scope: "full",
          addedAt: "2026-04-18T00:00:00.000Z",
          lastUsedAt: "2026-04-18T00:00:00.000Z",
        },
      },
      activeVaultId: "existing",
    });
    renderHome();
    // Home no longer redirects — App.tsx's NotesIndex dispatches to Notes
    // when a vault is active and mounts Home only when none is. Home's job
    // here is just: don't probe if there's already a vault.
    await waitFor(() => expect(fetchImpl).not.toHaveBeenCalled());
  });
});
