import { useVaultStore } from "@/lib/vault/store";
import { render, screen } from "@testing-library/react";
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
    // BrowserRouter is mounted with basename="/notes" (BASE_URL from Vite).
    // Tests simulate the external mount by placing the browser under /notes/.
    window.history.replaceState({}, "", "/notes/");
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the Parachute Notes wordmark and the connect CTA when no vaults exist", () => {
    render(<App />);
    expect(screen.getByRole("link", { name: /parachute notes/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /connect a vault/i })).toBeInTheDocument();
    expect(screen.getByText(/no vault connected/i)).toBeInTheDocument();
  });

  it("resolves the root list view at external /notes/ without double-prefixing", () => {
    render(<App />);
    // Regression guard against the /notes/notes bug: with basename="/notes"
    // stripping the external prefix, the internal path is "/" and the index
    // dispatcher (Home for no vault) renders. The URL must stay /notes/, not
    // become /notes/notes.
    expect(screen.getByRole("link", { name: /parachute notes/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/notes/");
  });

  it("resolves NoteView at external /notes/n/<id>", () => {
    window.history.replaceState({}, "", "/notes/n/some-id");
    render(<App />);
    // With no vault the NoteView route redirects internally to "/" (basename
    // strips /notes). The critical regression guard: the external URL must
    // sit under /notes, never /notes/notes.
    expect(window.location.pathname.startsWith("/notes")).toBe(true);
    expect(window.location.pathname.startsWith("/notes/notes")).toBe(false);
  });

  it("catch-all redirects to the root list, not /notes/notes", () => {
    window.history.replaceState({}, "", "/notes/some-unknown-internal-path");
    render(<App />);
    // The `*` route navigates to internal `/`. With basename=/notes this is
    // external /notes (with or without trailing slash — both resolve the root
    // list). The bug Aaron hit (/notes/notes) would surface here if basename
    // and route paths disagreed.
    expect(window.location.pathname).toMatch(/^\/notes\/?$/);
  });
});
