import { Today } from "@/app/routes/Today";
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
  updatedAt?: string;
  tags?: string[];
  preview?: string;
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

function Wrap({ children, initial = "/today" }: { children: ReactNode; initial?: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <MemoryRouter initialEntries={[initial]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/today" element={children} />
          <Route path="/" element={<LocationSpy />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

// Local-time ISO for a date key. Tests fake the clock, so build ISOs from
// Date so host-timezone drift doesn't flip buckets.
function localIso(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour).toISOString();
}

describe("Today route", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
    // Pin clock so todayKey() is stable across hosts.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 3, 18, 12, 0, 0));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });

  it("buckets notes into 'created today' and 'edited today' sections", async () => {
    installFetch([
      {
        id: "n1",
        path: "Morning.md",
        createdAt: localIso(2026, 4, 18, 9),
        updatedAt: localIso(2026, 4, 18, 9),
      },
      {
        id: "n2",
        path: "Earlier.md",
        createdAt: localIso(2026, 4, 15, 10),
        updatedAt: localIso(2026, 4, 18, 14),
      },
      {
        id: "n3",
        path: "Unrelated.md",
        createdAt: localIso(2026, 4, 10, 10),
      },
    ]);
    render(
      <Wrap>
        <Today />
      </Wrap>,
    );

    await screen.findByText("Morning.md");
    expect(screen.getByText(/created today \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText("Earlier.md")).toBeInTheDocument();
    expect(screen.getByText(/edited today \(1\)/i)).toBeInTheDocument();
    expect(screen.queryByText("Unrelated.md")).not.toBeInTheDocument();
  });

  it("renders 'On <date>' header with date param", async () => {
    installFetch([
      {
        id: "n1",
        path: "Past.md",
        createdAt: localIso(2026, 4, 10, 9),
      },
    ]);
    render(
      <Wrap initial="/today?date=2026-04-10">
        <Today />
      </Wrap>,
    );
    await screen.findByText("Past.md");
    expect(screen.getByText(/created on 2026-04-10 \(1\)/i)).toBeInTheDocument();
    // "Today" jump button is visible when not on today.
    expect(screen.getByRole("link", { name: /^today$/i })).toBeInTheDocument();
  });

  it("shows empty state with capture link when today is empty", async () => {
    installFetch([]);
    render(
      <Wrap>
        <Today />
      </Wrap>,
    );
    expect(await screen.findByText(/nothing yet today — start capturing/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open capture/i })).toBeInTheDocument();
  });

  it("shows dated empty copy (no capture button) for a past day", async () => {
    installFetch([]);
    render(
      <Wrap initial="/today?date=2026-04-10">
        <Today />
      </Wrap>,
    );
    expect(await screen.findByText(/nothing on 2026-04-10/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open capture/i })).not.toBeInTheDocument();
  });

  it("prev/next links point to the neighbouring day", async () => {
    installFetch([]);
    render(
      <Wrap initial="/today?date=2026-04-10">
        <Today />
      </Wrap>,
    );
    await screen.findByText(/nothing on 2026-04-10/i);
    expect(screen.getByRole("link", { name: /previous day/i })).toHaveAttribute(
      "href",
      "/today?date=2026-04-09",
    );
    expect(screen.getByRole("link", { name: /next day/i })).toHaveAttribute(
      "href",
      "/today?date=2026-04-11",
    );
  });

  it("renders an error block for invalid date param", async () => {
    installFetch([]);
    render(
      <Wrap initial="/today?date=not-a-date">
        <Today />
      </Wrap>,
    );
    expect(await screen.findByText(/invalid date in url: not-a-date/i)).toBeInTheDocument();
  });

  it("redirects home when no active vault", async () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    installFetch([]);
    render(
      <Wrap>
        <Today />
      </Wrap>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/");
    });
  });
});
