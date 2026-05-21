import { Header } from "@/components/Header";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeVault(partial: Partial<VaultRecord> & Pick<VaultRecord, "id" | "url">): VaultRecord {
  return {
    name: "",
    issuer: partial.url,
    clientId: "client-test",
    scope: "full",
    addedAt: "2026-04-18T00:00:00.000Z",
    lastUsedAt: "2026-04-18T00:00:00.000Z",
    ...partial,
  };
}

function renderHeader() {
  return render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>,
  );
}

describe("Header vault label fallback", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    // Stub fetch so the popover's well-known fetcher doesn't escape into a
    // real network call during component render.
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

  it("renders the vault name when present", () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "http://localhost:1940", name: "default" }) },
      activeVaultId: "a",
    });
    renderHeader();
    expect(screen.getByRole("button", { name: /active vault: default/i })).toBeInTheDocument();
  });

  it("falls back to the URL host when name is empty", () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "https://vault.example.com:8443/api", name: "" }) },
      activeVaultId: "a",
    });
    renderHeader();
    expect(
      screen.getByRole("button", { name: /active vault: vault\.example\.com:8443/i }),
    ).toBeInTheDocument();
  });

  it("falls back to the raw URL when both name and URL are unparseable", () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "not a url", name: "" }) },
      activeVaultId: "a",
    });
    renderHeader();
    expect(screen.getByRole("button", { name: /active vault: not a url/i })).toBeInTheDocument();
  });
});

// Responsive structure tests (notes#136). JSDOM doesn't compute layout, but
// these pin the class-name signal that drives the responsive break so a
// future refactor that drops `lg:`-gated visibility, `flex-wrap`, or the
// rem-based vault label cap is caught at the unit-test boundary instead of
// resurfacing as the same UX bug.
describe("Header responsive structure (notes#136)", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
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

  it("inline desktop cluster activates at lg (not md) so tablet widths use the menu", () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "http://localhost:1940", name: "default" }) },
      activeVaultId: "a",
    });
    renderHeader();
    // The hamburger lives in a `lg:hidden` cluster — confirm `lg:` is the
    // gate, not `md:` (the old gate that caused notes#136 brittleness).
    const hamburger = screen.getByRole("button", { name: /open menu/i });
    const mobileCluster = hamburger.parentElement;
    expect(mobileCluster?.className).toContain("lg:hidden");
    expect(mobileCluster?.className).not.toMatch(/\bmd:hidden\b/);
  });

  it("inline desktop cluster has flex-wrap so text-size scaling wraps instead of clipping", () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "http://localhost:1940", name: "default" }) },
      activeVaultId: "a",
    });
    const { container } = renderHeader();
    // Find the hidden-until-lg cluster: it carries `hidden` + `lg:flex` so
    // the row only mounts laid-out at desktop widths.
    const desktopCluster = container.querySelector(".hidden.lg\\:flex");
    expect(desktopCluster).not.toBeNull();
    expect(desktopCluster?.className).toContain("flex-wrap");
  });

  it("vault popover trigger caps its width in rem so long names truncate", () => {
    useVaultStore.setState({
      vaults: {
        a: makeVault({
          id: "a",
          url: "http://localhost:1940",
          name: "a-very-long-vault-name-that-would-push-siblings-offscreen",
        }),
      },
      activeVaultId: "a",
    });
    renderHeader();
    const trigger = screen.getByRole("button", { name: /active vault:/i });
    // rem-based cap (scales with text-size) + truncate so the label
    // compresses before its siblings get pushed off-screen.
    expect(trigger.className).toMatch(/max-w-\[\d+rem\]/);
    const labelSpan = trigger.querySelector("span.truncate");
    expect(labelSpan).not.toBeNull();
    expect(labelSpan?.textContent).toContain("a-very-long-vault-name");
  });
});
