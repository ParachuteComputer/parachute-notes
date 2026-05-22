import { VaultPopover, buildVaultPopoverRows } from "@/components/VaultPopover";
import type { HubVaultEntry } from "@/lib/vault/hub-discovery";
import * as oauthModule from "@/lib/vault/oauth";
import { InsecureContextError } from "@/lib/vault/pkce";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeVault(partial: Partial<VaultRecord> & Pick<VaultRecord, "id" | "url">): VaultRecord {
  return {
    name: "",
    issuer: "http://localhost:1939",
    clientId: "client-test",
    scope: "vault:read",
    addedAt: "2026-05-12T00:00:00.000Z",
    lastUsedAt: "2026-05-12T00:00:00.000Z",
    ...partial,
  };
}

function makeHubVault(name: string, url: string): HubVaultEntry {
  return { name, url, version: "0.1.0" };
}

describe("buildVaultPopoverRows", () => {
  it("returns just the connected vaults when the hub list is empty", () => {
    const v = makeVault({
      id: "v",
      url: "http://localhost:1939/vault/default",
      name: "default",
    });
    const rows = buildVaultPopoverRows([v], "v", [], "http://localhost:1939");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "connected", id: "v", isActive: true, hubKnown: false });
  });

  it("marks a connected vault as hubKnown when the hub publishes a matching URL", () => {
    const v = makeVault({
      id: "v",
      url: "http://localhost:1939/vault/default",
      name: "default",
    });
    const rows = buildVaultPopoverRows(
      [v],
      "v",
      [makeHubVault("default", "http://localhost:1939/vault/default")],
      "http://localhost:1939",
    );
    expect(rows.filter((r) => r.kind === "connected")).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "connected", hubKnown: true });
    expect(rows.filter((r) => r.kind === "available")).toHaveLength(0);
  });

  it("splits hub-only vaults into the Available section", () => {
    const v = makeVault({
      id: "v",
      url: "http://localhost:1939/vault/default",
      name: "default",
    });
    const rows = buildVaultPopoverRows(
      [v],
      "v",
      [
        makeHubVault("default", "http://localhost:1939/vault/default"),
        makeHubVault("techne", "http://localhost:1939/vault/techne"),
        makeHubVault("boulder", "http://localhost:1939/vault/boulder"),
      ],
      "http://localhost:1939",
    );
    const connected = rows.filter((r) => r.kind === "connected");
    const available = rows.filter((r) => r.kind === "available");
    expect(connected).toHaveLength(1);
    expect(available).toHaveLength(2);
    expect(available.map((r) => r.kind === "available" && r.name)).toEqual(["boulder", "techne"]);
  });

  it("returns no Available rows when hub origin is null (standalone-vault case)", () => {
    const v = makeVault({
      id: "v",
      url: "https://vault.example.com",
      name: "default",
      issuer: "https://vault.example.com",
    });
    const rows = buildVaultPopoverRows(
      [v],
      "v",
      [makeHubVault("other", "https://vault.example.com/vault/other")],
      null,
    );
    expect(rows.every((r) => r.kind === "connected")).toBe(true);
  });

  it("sorts Connected rows by display label", () => {
    const a = makeVault({
      id: "a",
      url: "http://localhost:1939/vault/charlie",
      name: "charlie",
    });
    const b = makeVault({
      id: "b",
      url: "http://localhost:1939/vault/alpha",
      name: "alpha",
    });
    const rows = buildVaultPopoverRows([a, b], "a", [], "http://localhost:1939");
    expect(rows.map((r) => r.kind === "connected" && r.label)).toEqual(["alpha", "charlie"]);
  });

  it("matches connected vs hub URLs after trailing-slash normalization", () => {
    const v = makeVault({
      id: "v",
      url: "http://localhost:1939/vault/default",
      name: "default",
    });
    const rows = buildVaultPopoverRows(
      [v],
      "v",
      [makeHubVault("default", "http://localhost:1939/vault/default/")],
      "http://localhost:1939",
    );
    expect(rows.filter((r) => r.kind === "available")).toHaveLength(0);
  });
});

describe("VaultPopover (component)", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    vi.restoreAllMocks();
    // Default: hub returns nothing
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ vaults: [], services: [] }),
        }) as Response,
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    vi.restoreAllMocks();
  });

  function renderPopover() {
    return render(
      <MemoryRouter>
        <VaultPopover />
      </MemoryRouter>,
    );
  }

  it("renders the active vault's label on the trigger", () => {
    useVaultStore.setState({
      vaults: {
        v: makeVault({ id: "v", url: "http://localhost:1939/vault/default", name: "default" }),
      },
      activeVaultId: "v",
    });
    renderPopover();
    expect(screen.getByRole("button", { name: /active vault: default/i })).toBeInTheDocument();
  });

  it("opens and closes on trigger click + closes on outside click", async () => {
    useVaultStore.setState({
      vaults: {
        v: makeVault({ id: "v", url: "http://localhost:1939/vault/default", name: "default" }),
      },
      activeVaultId: "v",
    });
    renderPopover();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("switches the active vault when a Connected row is clicked, then closes", async () => {
    useVaultStore.setState({
      vaults: {
        a: makeVault({ id: "a", url: "http://localhost:1939/vault/default", name: "default" }),
        b: makeVault({ id: "b", url: "http://localhost:1939/vault/techne", name: "techne" }),
      },
      activeVaultId: "a",
    });
    renderPopover();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    fireEvent.click(await screen.findByRole("button", { name: "techne" }));
    expect(useVaultStore.getState().activeVaultId).toBe("b");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("renders Available rows when the hub publishes additional vaults", async () => {
    useVaultStore.setState({
      vaults: {
        v: makeVault({ id: "v", url: "http://localhost:1939/vault/default", name: "default" }),
      },
      activeVaultId: "v",
    });
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            vaults: [
              { name: "default", url: "http://localhost:1939/vault/default", version: "0.1.0" },
              { name: "techne", url: "http://localhost:1939/vault/techne", version: "0.1.0" },
            ],
            services: [],
          }),
        }) as Response,
    ) as unknown as typeof fetch;
    renderPopover();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    await waitFor(() => expect(screen.getByText("Available from your hub")).toBeInTheDocument());
    expect(screen.getByText("techne")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Connect$/ })).toBeInTheDocument();
  });

  it("kicks beginOAuth with the vault hint when Connect is clicked", async () => {
    useVaultStore.setState({
      vaults: {
        v: makeVault({ id: "v", url: "http://localhost:1939/vault/default", name: "default" }),
      },
      activeVaultId: "v",
    });
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            vaults: [
              { name: "default", url: "http://localhost:1939/vault/default", version: "0.1.0" },
              { name: "techne", url: "http://localhost:1939/vault/techne", version: "0.1.0" },
            ],
            services: [],
          }),
        }) as Response,
    ) as unknown as typeof fetch;
    const beginSpy = vi.spyOn(oauthModule, "beginOAuth").mockResolvedValue({
      authorizeUrl: "http://localhost:1939/oauth/authorize?test",
      pending: {
        issuerUrl: "http://localhost:1939",
        issuer: "http://localhost:1939",
        tokenEndpoint: "http://localhost:1939/oauth/token",
        clientId: "x",
        codeVerifier: "v",
        state: "s",
        redirectUri: "r",
        scope: "vault:read",
        startedAt: "now",
      },
    });
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, assign: assignSpy },
    });

    renderPopover();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    await waitFor(() => expect(screen.getByText("techne")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Connect$/ }));
    });

    await waitFor(() => expect(beginSpy).toHaveBeenCalled());
    expect(beginSpy.mock.calls[0]?.[0]).toBe("http://localhost:1939");
    expect(beginSpy.mock.calls[0]?.[3]).toEqual({ params: { vault: "techne" } });
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith("http://localhost:1939/oauth/authorize?test"),
    );
  });

  // notes#143 follow-up: a refactor of the Connect handler could silently
  // drop the InsecureContextError branch and the user would be back to the
  // cryptic generic-error one-liner. Pin the wiring with a component-level
  // test that doesn't depend on AddVault.
  it("renders the InsecureContextBanner when beginOAuth throws InsecureContextError", async () => {
    useVaultStore.setState({
      vaults: {
        v: makeVault({ id: "v", url: "http://localhost:1939/vault/default", name: "default" }),
      },
      activeVaultId: "v",
    });
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            vaults: [
              { name: "default", url: "http://localhost:1939/vault/default", version: "0.1.0" },
              { name: "techne", url: "http://localhost:1939/vault/techne", version: "0.1.0" },
            ],
            services: [],
          }),
        }) as Response,
    ) as unknown as typeof fetch;
    vi.spyOn(oauthModule, "beginOAuth").mockRejectedValue(
      new InsecureContextError("insecure context"),
    );

    renderPopover();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    await waitFor(() => expect(screen.getByText("techne")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Connect$/ }));
    });

    const banner = await screen.findByTestId("insecure-context-banner");
    expect(banner).toHaveTextContent(/Insecure context/i);
    expect(banner).toHaveTextContent(/HTTPS or accessed at/i);
  });

  it("does not render the InsecureContextBanner on a generic beginOAuth error", async () => {
    useVaultStore.setState({
      vaults: {
        v: makeVault({ id: "v", url: "http://localhost:1939/vault/default", name: "default" }),
      },
      activeVaultId: "v",
    });
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            vaults: [
              { name: "default", url: "http://localhost:1939/vault/default", version: "0.1.0" },
              { name: "techne", url: "http://localhost:1939/vault/techne", version: "0.1.0" },
            ],
            services: [],
          }),
        }) as Response,
    ) as unknown as typeof fetch;
    vi.spyOn(oauthModule, "beginOAuth").mockRejectedValue(new Error("hub returned 502"));

    renderPopover();
    fireEvent.click(screen.getByRole("button", { name: /active vault/i }));
    await waitFor(() => expect(screen.getByText("techne")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Connect$/ }));
    });

    // The dedicated banner stays hidden; the generic error line surfaces instead.
    await waitFor(() => expect(screen.getByText(/hub returned 502/i)).toBeInTheDocument());
    expect(screen.queryByTestId("insecure-context-banner")).not.toBeInTheDocument();
  });
});
