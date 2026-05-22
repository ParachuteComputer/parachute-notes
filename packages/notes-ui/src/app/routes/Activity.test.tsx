import { Activity } from "@/app/routes/Activity";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
        url: "http://localhost:1940/vault/default",
        name: "default",
        issuer: "http://localhost:1940/vault/default",
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

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <MemoryRouter initialEntries={["/activity"]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/activity" element={children} />
          <Route path="/" element={<LocationSpy />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function localIso(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour).toISOString();
}

describe("Activity route", () => {
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

  it("groups events into Today / Yesterday / This week / Older", async () => {
    installFetch([
      { id: "n1", path: "Today.md", createdAt: localIso(2026, 4, 18, 9) },
      { id: "n2", path: "Yesterday.md", createdAt: localIso(2026, 4, 17, 9) },
      { id: "n3", path: "Wk.md", createdAt: localIso(2026, 4, 14, 9) },
      { id: "n4", path: "Old.md", createdAt: localIso(2026, 4, 1, 9) },
    ]);
    render(
      <Wrap>
        <Activity />
      </Wrap>,
    );

    await screen.findByText("Today.md");
    expect(screen.getByText(/^today \(1\)$/i)).toBeInTheDocument();
    expect(screen.getByText(/^yesterday \(1\)$/i)).toBeInTheDocument();
    expect(screen.getByText(/^this week \(1\)$/i)).toBeInTheDocument();
    expect(screen.getByText(/^older \(1\)$/i)).toBeInTheDocument();
  });

  it("renders both Created and Edited rows for an updated note", async () => {
    installFetch([
      {
        id: "n1",
        path: "Edited.md",
        createdAt: localIso(2026, 4, 15, 10),
        updatedAt: localIso(2026, 4, 18, 14),
      },
    ]);
    render(
      <Wrap>
        <Activity />
      </Wrap>,
    );

    await screen.findAllByText("Edited.md");
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Edited")).toBeInTheDocument();
  });

  it("shows the empty state with capture link when there's nothing", async () => {
    installFetch([]);
    render(
      <Wrap>
        <Activity />
      </Wrap>,
    );
    expect(await screen.findByText(/no activity in the last 30 days/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open capture/i })).toBeInTheDocument();
  });

  it("paginates with Load more and reveals the next 50", async () => {
    // 60 distinct notes inside the 30-day window — first 50 shown, 10 hidden
    // until the user clicks Load more.
    const notes: Row[] = [];
    for (let i = 0; i < 60; i++) {
      notes.push({
        id: `n${i}`,
        path: `N${i}.md`,
        createdAt: localIso(2026, 4, 18, 11 - Math.floor(i / 10)),
      });
    }
    installFetch(notes);
    render(
      <Wrap>
        <Activity />
      </Wrap>,
    );

    await screen.findByText("N0.md");
    expect(screen.queryByText("N50.md")).not.toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /load more \(10 remaining\)/i });
    fireEvent.click(btn);
    await screen.findByText("N50.md");
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("redirects home when no active vault", async () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    installFetch([]);
    render(
      <Wrap>
        <Activity />
      </Wrap>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/");
    });
  });
});
