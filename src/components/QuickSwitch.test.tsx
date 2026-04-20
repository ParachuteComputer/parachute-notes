import { QuickSwitch } from "@/components/QuickSwitch";
import { QuickSwitchMount } from "@/components/QuickSwitchMount";
import { pushRecent } from "@/lib/quick-switch/recents";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function seedStore() {
  useVaultStore.setState({
    vaults: {
      v1: {
        id: "v1",
        url: "http://localhost:1940",
        name: "default",
        issuer: "http://localhost:1940",
        clientId: "c",
        scope: "full",
        addedAt: "2026-04-18T00:00:00.000Z",
        lastUsedAt: "2026-04-18T00:00:00.000Z",
      },
    },
    activeVaultId: "v1",
  });
  localStorage.setItem(
    "lens:token:v1",
    JSON.stringify({ accessToken: "t", scope: "full", vault: "default" }),
  );
}

function installFetch(notes: unknown[], tags: unknown[] = []) {
  const impl = vi.fn<typeof fetch>(async (input) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    if (url.includes("/api/tags")) {
      return { ok: true, status: 200, json: async () => tags, text: async () => "" } as Response;
    }
    return { ok: true, status: 200, json: async () => notes, text: async () => "" } as Response;
  });
  vi.stubGlobal("fetch", impl);
}

function LocationSpy() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function Wrap({ children, initial = "/" }: { children: ReactNode; initial?: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <MemoryRouter initialEntries={[initial]}>
      <QueryClientProvider client={qc}>
        <LocationSpy />
        <Routes>
          <Route path="*" element={children} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("QuickSwitch", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });

  it("filters results as the user types and navigates on Enter", async () => {
    installFetch([
      { id: "canon", path: "Canon/Aaron.md", createdAt: "2026-04-18T00:00:00Z" },
      { id: "journal", path: "Journal/Day.md", createdAt: "2026-04-18T00:00:00Z" },
    ]);
    render(
      <Wrap>
        <QuickSwitch onClose={() => {}} />
      </Wrap>,
    );

    const input = screen.getByLabelText(/quick switch query/i);
    // Wait for the notes fetch to populate.
    await waitFor(() => expect(screen.queryByText(/loading notes/i)).not.toBeInTheDocument());

    fireEvent.change(input, { target: { value: "aaron" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/n/canon"));
  });

  it("arrow keys move the selection", async () => {
    installFetch([
      { id: "a", path: "Alpha.md", createdAt: "2026-04-18T00:00:00Z" },
      { id: "b", path: "Alphabet.md", createdAt: "2026-04-18T00:00:00Z" },
    ]);
    render(
      <Wrap>
        <QuickSwitch onClose={() => {}} />
      </Wrap>,
    );
    const input = screen.getByLabelText(/quick switch query/i);
    fireEvent.change(input, { target: { value: "alpha" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    // Second entry gets selected.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/n/b"));
  });

  it("Escape closes the switcher", async () => {
    installFetch([]);
    const onClose = vi.fn();
    render(
      <Wrap>
        <QuickSwitch onClose={onClose} />
      </Wrap>,
    );
    const input = screen.getByLabelText(/quick switch query/i);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows recent notes as the empty-query starting list", async () => {
    pushRecent("v1", "canon", 1);
    installFetch([
      { id: "canon", path: "Canon/Aaron.md", createdAt: "2026-04-18T00:00:00Z" },
      { id: "other", path: "Other.md", createdAt: "2026-04-18T00:00:00Z" },
    ]);
    render(
      <Wrap>
        <QuickSwitch onClose={() => {}} />
      </Wrap>,
    );
    await waitFor(() => {
      const options = screen.getAllByRole("option");
      expect(options[0]?.textContent).toContain("Aaron");
    });
  });

  it("> prefix surfaces commands — typing '>new' jumps to /new on Enter", async () => {
    installFetch([]);
    render(
      <Wrap>
        <QuickSwitch onClose={() => {}} />
      </Wrap>,
    );
    const input = screen.getByLabelText(/quick switch query/i);
    fireEvent.change(input, { target: { value: ">new" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/new"));
  });
});

describe("QuickSwitchMount", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });

  it("opens on Cmd+K and closes on a second press", async () => {
    installFetch([]);
    render(
      <Wrap>
        <QuickSwitchMount />
      </Wrap>,
    );
    expect(screen.queryByLabelText(/quick switch query/i)).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByLabelText(/quick switch query/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.queryByLabelText(/quick switch query/i)).not.toBeInTheDocument();
  });

  it("also opens on Ctrl+K for non-Mac users", () => {
    installFetch([]);
    render(
      <Wrap>
        <QuickSwitchMount />
      </Wrap>,
    );
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByLabelText(/quick switch query/i)).toBeInTheDocument();
  });

  it("does not hijack a plain 'k' keypress", () => {
    installFetch([]);
    render(
      <Wrap>
        <QuickSwitchMount />
      </Wrap>,
    );
    fireEvent.keyDown(window, { key: "k" });
    expect(screen.queryByLabelText(/quick switch query/i)).not.toBeInTheDocument();
  });
});
