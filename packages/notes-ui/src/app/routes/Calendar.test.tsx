import { Calendar } from "@/app/routes/Calendar";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  id: string;
  path: string;
  createdAt: string;
}

function installFetch(notes: Row[]) {
  const impl = vi.fn<typeof fetch>(async () => {
    return {
      ok: true,
      status: 200,
      json: async () => notes,
      text: async () => "",
    } as Response;
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

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

function LocationSpy() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function Wrap({ children, initial = "/calendar" }: { children: ReactNode; initial?: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <MemoryRouter initialEntries={[initial]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/calendar" element={children} />
          <Route path="/today" element={<LocationSpy />} />
          <Route path="/" element={<LocationSpy />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function localIso(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour).toISOString();
}

describe("Calendar route", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 3, 18, 12, 0, 0));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });

  it("renders the long month header for the requested month", async () => {
    installFetch([]);
    render(
      <Wrap initial="/calendar?month=2026-04">
        <Calendar />
      </Wrap>,
    );
    expect(await screen.findByRole("heading", { name: /april 2026/i })).toBeInTheDocument();
  });

  it("renders 42 day cells (6 weeks)", async () => {
    installFetch([]);
    render(
      <Wrap initial="/calendar?month=2026-04">
        <Calendar />
      </Wrap>,
    );
    const cells = await screen.findAllByRole("link", { name: /\d{4}-\d{2}-\d{2} — \d+ notes/ });
    expect(cells.length).toBe(42);
  });

  it("aggregates note counts by createdAt local-day key", async () => {
    installFetch([
      { id: "n1", path: "a", createdAt: localIso(2026, 4, 18, 9) },
      { id: "n2", path: "b", createdAt: localIso(2026, 4, 18, 14) },
      { id: "n3", path: "c", createdAt: localIso(2026, 4, 19, 9) },
    ]);
    render(
      <Wrap initial="/calendar?month=2026-04">
        <Calendar />
      </Wrap>,
    );
    const cell18 = await screen.findByLabelText(/2026-04-18 — 2 notes/i);
    expect(cell18).toBeInTheDocument();
    expect(screen.getByLabelText(/2026-04-19 — 1 notes/i)).toBeInTheDocument();
    // Days with no notes still get an aria-label with "0 notes".
    expect(screen.getByLabelText(/2026-04-01 — 0 notes/i)).toBeInTheDocument();
  });

  it("shows '+N more' when a day exceeds the visible-dot cap", async () => {
    const day = 18;
    const notes = Array.from({ length: 8 }, (_, i) => ({
      id: `n${i}`,
      path: `n${i}`,
      createdAt: localIso(2026, 4, day, i),
    }));
    installFetch(notes);
    render(
      <Wrap initial="/calendar?month=2026-04">
        <Calendar />
      </Wrap>,
    );
    await screen.findByLabelText(/2026-04-18 — 8 notes/i);
    // 8 notes - 5 visible dots = +3 more.
    expect(screen.getByText("+3")).toBeInTheDocument();
  });

  it("prev/next month links use shifted YYYY-MM keys", async () => {
    installFetch([]);
    render(
      <Wrap initial="/calendar?month=2026-01">
        <Calendar />
      </Wrap>,
    );
    await screen.findByRole("heading", { name: /january 2026/i });
    expect(screen.getByRole("link", { name: /previous month/i })).toHaveAttribute(
      "href",
      "/calendar?month=2025-12",
    );
    expect(screen.getByRole("link", { name: /next month/i })).toHaveAttribute(
      "href",
      "/calendar?month=2026-02",
    );
  });

  it("clicking a day navigates to /today?date=<key>", async () => {
    installFetch([]);
    render(
      <Wrap initial="/calendar?month=2026-04">
        <Calendar />
      </Wrap>,
    );
    const cell = await screen.findByLabelText(/2026-04-15 — 0 notes/i);
    cell.click();
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/today?date=2026-04-15");
    });
  });

  it("redirects home when no active vault", async () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    installFetch([]);
    render(
      <Wrap>
        <Calendar />
      </Wrap>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/");
    });
  });
});
