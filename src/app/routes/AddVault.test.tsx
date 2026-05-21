import { AddVault } from "@/app/routes/AddVault";
import { useVaultStore } from "@/lib/vault/store";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// Aaron hit "Cannot read properties of undefined (reading 'digest')" on
// fresh-install testing when serving Notes from a non-HTTPS / non-localhost
// origin. The defensive check in `pkce.ts` now throws
// `InsecureContextError` up front, and AddVault must render the dedicated
// banner (distinct colour + structured remediations) rather than the
// generic "Connection failed" red strip — that's what tells the operator
// the failure mode is "your browser refuses Web Crypto here," not "your
// hub is down."
describe("AddVault insecure-context handling", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it("renders the insecure-context banner instead of the generic error when crypto.subtle is undefined", async () => {
    // Stub fetch so discovery returns valid AS metadata + DCR succeeds —
    // beginOAuth has to get past discovery and registration before it
    // calls `deriveCodeChallenge`, which is where the PKCE defensive
    // check fires. The origin-probe fetch on mount uses the same impl
    // and is harmless against a metadata-shaped response.
    const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/.well-known/oauth-authorization-server")) {
        return {
          ok: true,
          status: 200,
          json: async () => validMetadata,
          text: async () => JSON.stringify(validMetadata),
        } as Response;
      }
      if (url.endsWith("/oauth/register")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ client_id: "test-client" }),
          text: async () => "",
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" } as Response;
    });
    vi.stubGlobal("fetch", fetchImpl);

    // Simulate a non-secure-context browser: crypto exists for
    // `getRandomValues` (verifier + state still need entropy) but
    // `subtle` is missing entirely — exactly the W3C secure-context
    // gating Aaron hit at `http://192.168.1.10:1939`.
    vi.stubGlobal("crypto", {
      getRandomValues: <T extends ArrayBufferView | null>(buf: T): T => {
        if (buf && "length" in buf) {
          const view = buf as unknown as Uint8Array;
          for (let i = 0; i < view.length; i++) view[i] = (i * 7) & 0xff;
        }
        return buf;
      },
    });

    renderAddVault();
    const input = screen.getByLabelText(/hub url/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "http://192.168.1.10:1939" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    // The distinct banner appears with both remediation paths.
    const banner = await screen.findByTestId("insecure-context-banner");
    expect(banner).toHaveTextContent(/Insecure context/i);
    expect(banner).toHaveTextContent(/HTTPS or accessed at/i);
    expect(banner).toHaveTextContent(/localhost/i);
    expect(banner).toHaveTextContent(/Tailscale Serve|Cloudflare Tunnel|reverse proxy/i);
    // Make sure we did NOT fall through to the generic "Cannot read
    // properties of undefined" surfaced by the cryptic error — the
    // banner is the only message the user should see.
    expect(banner.textContent).not.toMatch(/Cannot read properties of undefined/i);
  });
});
