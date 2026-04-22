import { useVaultStore } from "@/lib/vault/store";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response("{}", { status: 404 })),
  );
}

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    // BrowserRouter is mounted with basename="/lens" (BASE_URL from Vite).
    // Tests simulate the external mount by placing the browser under /lens/.
    window.history.replaceState({}, "", "/lens/");
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the Parachute Lens wordmark and the connect CTA when no vaults exist", async () => {
    render(<App />);
    expect(screen.getByRole("link", { name: /parachute lens/i })).toBeInTheDocument();
    // Home holds back the CTA until the origin probe settles to avoid
    // flashing "Connect a vault" before swapping to "Looks like there's a
    // vault at …". Wait for the probe to resolve before asserting the CTA.
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /connect a vault/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/no vault connected/i)).toBeInTheDocument();
  });

  it("resolves the root list view at external /lens/ without double-prefixing", () => {
    render(<App />);
    // Regression guard against the /lens/lens bug: with basename="/lens"
    // stripping the external prefix, the internal path is "/" and the index
    // dispatcher (Home for no vault) renders. The URL must stay /lens/, not
    // become /lens/lens.
    expect(screen.getByRole("link", { name: /parachute lens/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/lens/");
  });

  it("resolves NoteView at external /lens/n/<id>", () => {
    window.history.replaceState({}, "", "/lens/n/some-id");
    render(<App />);
    // With no vault the NoteView route redirects internally to "/" (basename
    // strips /lens). The critical regression guard: the external URL must
    // sit under /lens, never /lens/lens.
    expect(window.location.pathname.startsWith("/lens")).toBe(true);
    expect(window.location.pathname.startsWith("/lens/lens")).toBe(false);
  });

  it("catch-all redirects to the root list, not /lens/lens", () => {
    window.history.replaceState({}, "", "/lens/some-unknown-internal-path");
    render(<App />);
    // The `*` route navigates to internal `/`. With basename=/lens this is
    // external /lens (with or without trailing slash — both resolve the root
    // list). The bug Aaron hit (/lens/lens) would surface here if basename
    // and route paths disagreed.
    expect(window.location.pathname).toMatch(/^\/lens\/?$/);
  });

  it("clamps horizontal overflow at the shell so a stray wide descendant can't scroll the viewport", () => {
    render(<App />);
    // Belt-and-suspenders against mobile overflow regressions. If any
    // descendant (a long unbreakable path, a rogue min-width, a missing
    // min-w-0 in a deep flex chain) ever exceeds the viewport width, the
    // shell clips it to the viewport instead of turning the whole page into
    // a horizontal scroller. jsdom doesn't compute layout, so this is a
    // class-presence check, not a measured scrollWidth assertion — the
    // manual-testing steps live in the PR body.
    const shell = screen.getByRole("link", { name: /parachute lens/i }).closest("div.min-h-dvh");
    expect(shell).not.toBeNull();
    expect(shell?.className).toMatch(/\boverflow-x-hidden\b/);
  });

  it("static route /settings wins over the dynamic /:id deep-link shim", () => {
    useVaultStore.setState({
      vaults: {
        v1: {
          id: "v1",
          url: "http://localhost:1940",
          name: "default",
          issuer: "http://localhost:1940",
          clientId: "c",
          scope: "full",
          addedAt: "2026-04-20T00:00:00.000Z",
          lastUsedAt: "2026-04-20T00:00:00.000Z",
        },
      },
      activeVaultId: "v1",
    });
    window.history.replaceState({}, "", "/lens/settings");
    render(<App />);
    // Regression guard against future route-table accidents: RR7's ranked
    // routing must hold `/settings` (and every other named static route)
    // above the `/:id` pre-#49 bookmark shim. If this ever fails, the shim
    // would start swallowing real internal pages.
    expect(screen.getByRole("heading", { level: 1, name: /settings/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/lens/settings");
  });
});
