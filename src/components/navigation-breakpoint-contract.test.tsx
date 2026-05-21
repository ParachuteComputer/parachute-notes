import { BottomTabBar } from "@/components/BottomTabBar";
import { Header } from "@/components/Header";
import { useQuickSwitchOpen } from "@/lib/quick-switch/open-store";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Contract test (notes#147): the primary-navigation cluster in Header
// (desktop) and BottomTabBar (mobile + tablet) MUST share the same
// breakpoint and meet without a gap. Header's desktop inline cluster is
// gated `hidden lg:flex` (only visible at >= lg); BottomTabBar is
// `lg:hidden` (visible until >= lg). At any viewport width, exactly one
// renders. The earlier shipping pair was `md:hidden` + `lg:flex` which left
// the 768-1023px band without primary nav — that's the regression this
// test exists to prevent.
//
// JSDOM can't compute layout, so the assertion is at the class-name level:
// the two components must use the same `lg` breakpoint, opposite
// directions, with no gap.

function makeVault(partial: Partial<VaultRecord> & Pick<VaultRecord, "id" | "url">): VaultRecord {
  return {
    name: "default",
    issuer: partial.url,
    clientId: "client-test",
    scope: "full",
    addedAt: "2026-04-22T00:00:00.000Z",
    lastUsedAt: "2026-04-22T00:00:00.000Z",
    ...partial,
  };
}

function seedActiveVault() {
  useVaultStore.setState({
    vaults: { a: makeVault({ id: "a", url: "http://localhost:1940", name: "default" }) },
    activeVaultId: "a",
  });
}

describe("Header + BottomTabBar breakpoint contract (notes#147)", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useQuickSwitchOpen.setState({ open: false });
    // Stub fetch so Header's VaultPopover well-known fetcher doesn't
    // escape into a real network call during render.
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ vaults: [], services: [] }),
        }) as Response,
    ) as unknown as typeof fetch;
    seedActiveVault();
  });

  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useQuickSwitchOpen.setState({ open: false });
    vi.restoreAllMocks();
  });

  it("BottomTabBar hides at lg+ and Header desktop cluster shows at lg+ — same gate, opposite direction, no gap", () => {
    const { container: headerContainer } = render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );
    const { container: tabBarContainer } = render(
      <MemoryRouter>
        <BottomTabBar />
      </MemoryRouter>,
    );

    // Header's desktop inline cluster: `hidden lg:flex` (renders at >= lg).
    const desktopCluster = headerContainer.querySelector(".hidden.lg\\:flex");
    expect(desktopCluster, "Header desktop cluster (.hidden.lg:flex) must exist").not.toBeNull();

    // BottomTabBar's primary nav: `lg:hidden` (renders at < lg).
    const tabBarNav = tabBarContainer.querySelector('nav[aria-label="Primary"]');
    expect(tabBarNav, "BottomTabBar primary nav must exist when a vault is active").not.toBeNull();
    expect(tabBarNav?.className).toMatch(/\blg:hidden\b/);

    // The hard contract: neither side may use `md:` for the visibility
    // gate. If one drifts to `md` while the other stays at `lg`, the
    // 768-1023px band loses primary navigation entirely.
    expect(desktopCluster?.className).not.toMatch(/\bmd:flex\b/);
    expect(desktopCluster?.className).not.toMatch(/\bmd:hidden\b/);
    expect(tabBarNav?.className).not.toMatch(/\bmd:hidden\b/);
    expect(tabBarNav?.className).not.toMatch(/\bmd:flex\b/);
  });

  it("Header mobile hamburger cluster also uses lg:hidden (stays visible at tablet widths alongside the BottomTabBar)", () => {
    const { container } = render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );

    // The hamburger button's parent cluster is `lg:hidden` — together with
    // the BottomTabBar's `lg:hidden`, the mobile+tablet primary-nav
    // surface area is consistent.
    const hamburger = container.querySelector('button[aria-label="Open menu"]');
    expect(hamburger).not.toBeNull();
    const mobileCluster = hamburger?.parentElement;
    expect(mobileCluster?.className).toContain("lg:hidden");
    expect(mobileCluster?.className).not.toMatch(/\bmd:hidden\b/);
  });
});
