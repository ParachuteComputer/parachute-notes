import { BottomTabBar } from "@/components/BottomTabBar";
import { useQuickSwitchOpen } from "@/lib/quick-switch/open-store";
import { useVaultStore } from "@/lib/vault/store";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function seedVault() {
  useVaultStore.setState({
    vaults: {
      v1: {
        id: "v1",
        url: "http://localhost:1940",
        name: "dev",
        issuer: "http://localhost:1940",
        clientId: "c",
        scope: "full",
        addedAt: "2026-04-22T00:00:00.000Z",
        lastUsedAt: "2026-04-22T00:00:00.000Z",
      },
    },
    activeVaultId: "v1",
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BottomTabBar />
    </MemoryRouter>,
  );
}

describe("BottomTabBar", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useQuickSwitchOpen.setState({ open: false });
    seedVault();
  });

  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useQuickSwitchOpen.setState({ open: false });
  });

  it("renders Home, Tags, Capture, Search, Settings tabs when a vault is active", () => {
    renderAt("/");
    const nav = screen.getByRole("navigation", { name: /primary/i });
    expect(within(nav).getByLabelText(/home/i)).toBeInTheDocument();
    expect(within(nav).getByLabelText(/^tags$/i)).toBeInTheDocument();
    expect(within(nav).getByLabelText(/capture/i)).toBeInTheDocument();
    expect(within(nav).getByLabelText(/search/i)).toBeInTheDocument();
    expect(within(nav).getByLabelText(/settings/i)).toBeInTheDocument();
  });

  it("does not render when no active vault", () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    renderAt("/");
    expect(screen.queryByRole("navigation", { name: /primary/i })).toBeNull();
  });

  it("is hidden on lg+ viewports via lg:hidden class (matches Header desktop-cluster lg:flex gate — notes#147)", () => {
    renderAt("/");
    const nav = screen.getByRole("navigation", { name: /primary/i });
    expect(nav.className).toMatch(/\blg:hidden\b/);
    // Guard against regressing back to `md:hidden` — at 768-1023px that
    // would hide BottomTabBar while Header's desktop cluster (lg:flex) is
    // still hidden too, leaving tablet users with no primary navigation.
    expect(nav.className).not.toMatch(/\bmd:hidden\b/);
  });

  it("marks the Home tab active on /", () => {
    renderAt("/");
    const home = screen.getByLabelText(/home/i);
    expect(home).toHaveAttribute("aria-current", "page");
  });

  it("marks the Tags tab active on /tags", () => {
    renderAt("/tags");
    const tags = screen.getByLabelText(/^tags$/i);
    expect(tags).toHaveAttribute("aria-current", "page");
  });

  it("keeps Home tab active on /n/:id (reading a note is still under Home)", () => {
    renderAt("/n/abc");
    const home = screen.getByLabelText(/home/i);
    expect(home).toHaveAttribute("aria-current", "page");
  });

  it("opens the quick-switch via the Search tab", () => {
    renderAt("/");
    expect(useQuickSwitchOpen.getState().open).toBe(false);
    fireEvent.click(screen.getByLabelText(/search/i));
    expect(useQuickSwitchOpen.getState().open).toBe(true);
  });

  it("Capture tab navigates to /capture", () => {
    renderAt("/");
    const capture = screen.getByLabelText(/capture/i);
    expect(capture).toHaveAttribute("href", "/capture");
  });
});
