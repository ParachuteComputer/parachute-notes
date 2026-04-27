import { AddVault } from "@/app/routes/AddVault";
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

function renderAddVault(initialPath = "/add") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/add" element={<AddVault />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AddVault URL prefill", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it("prefills the URL input from ?url= regardless of probe outcome", async () => {
    mockFetchOnce({ throwNetwork: true });
    renderAddVault("/add?url=http%3A%2F%2Fvault.example%3A1940");
    const input = screen.getByLabelText(/hub url/i) as HTMLInputElement;
    expect(input.value).toBe("http://vault.example:1940");
  });

  it("prefills the URL input with the detected origin when the probe succeeds", async () => {
    mockFetchOnce({ json: validMetadata });
    renderAddVault();
    const input = screen.getByLabelText(/hub url/i) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe(window.location.origin));
  });

  it("leaves the URL input empty when the probe fails", async () => {
    const fetchImpl = mockFetchOnce({ throwNetwork: true });
    renderAddVault();
    const input = screen.getByLabelText(/hub url/i) as HTMLInputElement;
    // Wait for the probe to settle — fetchImpl should have been called.
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(input.value).toBe("");
  });
});
