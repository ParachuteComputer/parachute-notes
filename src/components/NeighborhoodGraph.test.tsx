import { NeighborhoodGraph } from "@/components/NeighborhoodGraph";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the force graph lib — jsdom has no canvas, and we only care about
// the data/click wiring, not the actual rendering.
interface MockGraphData {
  nodes: Array<{ id: string; isAnchor?: boolean }>;
  links: Array<{ source: string; target: string; rel?: string }>;
}

vi.mock("react-force-graph-2d", () => ({
  default: (props: {
    graphData: MockGraphData;
    onNodeClick: (n: { id: string }) => void;
  }) => (
    <div data-testid="mock-force-graph">
      <span data-testid="node-count">{props.graphData.nodes.length}</span>
      <span data-testid="link-count">{props.graphData.links.length}</span>
      <ul>
        {props.graphData.nodes.map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => props.onNodeClick(n)}>
              {n.id}
              {n.isAnchor ? " (anchor)" : ""}
            </button>
          </li>
        ))}
      </ul>
    </div>
  ),
}));

// jsdom doesn't implement ResizeObserver.
beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    class MockResizeObserver {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
});

function seedActiveVault() {
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
  // Minimal fake token so useActiveVaultClient returns a client.
  localStorage.setItem(
    "lens:token:v1",
    JSON.stringify({ accessToken: "t", scope: "full", vault: "default" }),
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <MemoryRouter initialEntries={["/notes/A"]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/notes/A" element={children} />
          <Route path="/notes/:id" element={<div data-testid="note-route" />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function mockFetchReturning(byId: Record<string, unknown>) {
  const impl = vi.fn<typeof fetch>(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const params = new URL(url).searchParams;
    const id = params.get("id") ?? "";
    const body = byId[id] ?? [];
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => "",
    } as Response;
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

describe("NeighborhoodGraph", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
  });

  const anchor = {
    id: "A",
    path: "notes/A",
    createdAt: "2026-04-18T00:00:00.000Z",
    links: [
      { sourceId: "A", targetId: "B", relationship: "wikilink" },
      { sourceId: "C", targetId: "A", relationship: "wikilink" },
    ],
  };

  it("renders the graph with anchor and neighbors at depth 2", async () => {
    seedActiveVault();
    mockFetchReturning({
      B: { id: "B", path: "notes/B", createdAt: "2026-04-18T00:00:00.000Z" },
      C: { id: "C", path: "notes/C", createdAt: "2026-04-18T00:00:00.000Z" },
    });
    render(
      <Wrap>
        <NeighborhoodGraph anchor={anchor} />
      </Wrap>,
    );

    await waitFor(() => expect(screen.getByTestId("node-count").textContent).toBe("3"));
    expect(screen.getByTestId("link-count").textContent).toBe("2");
    expect(screen.getByRole("button", { name: /A \(anchor\)/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^B$/ })).toBeInTheDocument();
  });

  it("shows the empty state when the note has no neighbors", async () => {
    seedActiveVault();
    mockFetchReturning({});
    render(
      <Wrap>
        <NeighborhoodGraph anchor={{ ...anchor, links: [] }} />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByText(/no neighbors yet/i)).toBeInTheDocument());
    expect(screen.queryByTestId("mock-force-graph")).not.toBeInTheDocument();
  });

  it("clicking a node navigates to that note", async () => {
    seedActiveVault();
    mockFetchReturning({
      B: { id: "B", path: "notes/B", createdAt: "2026-04-18T00:00:00.000Z" },
      C: { id: "C", path: "notes/C", createdAt: "2026-04-18T00:00:00.000Z" },
    });
    render(
      <Wrap>
        <NeighborhoodGraph anchor={anchor} />
      </Wrap>,
    );
    const btn = await screen.findByRole("button", { name: /^B$/ });
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(screen.getByTestId("note-route")).toBeInTheDocument());
  });

  it("depth=1 does not fetch any neighbors", async () => {
    seedActiveVault();
    const fetchImpl = mockFetchReturning({
      B: { id: "B", path: "notes/B", createdAt: "2026-04-18T00:00:00.000Z" },
      C: { id: "C", path: "notes/C", createdAt: "2026-04-18T00:00:00.000Z" },
    });
    render(
      <Wrap>
        <NeighborhoodGraph anchor={anchor} />
      </Wrap>,
    );
    // Settle depth 2 default first (renders with 3 nodes).
    await waitFor(() => expect(screen.getByTestId("node-count").textContent).toBe("3"));
    fetchImpl.mockClear();

    const depth1 = screen.getByRole("button", { name: "1" });
    await act(async () => {
      fireEvent.click(depth1);
    });

    await waitFor(() => expect(screen.getByText(/no neighbors yet/i)).toBeInTheDocument());
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("collapses and re-expands via the header toggle", async () => {
    seedActiveVault();
    mockFetchReturning({
      B: { id: "B", path: "notes/B", createdAt: "2026-04-18T00:00:00.000Z" },
      C: { id: "C", path: "notes/C", createdAt: "2026-04-18T00:00:00.000Z" },
    });
    render(
      <Wrap>
        <NeighborhoodGraph anchor={anchor} />
      </Wrap>,
    );
    await screen.findByTestId("mock-force-graph");
    const toggle = screen.getByRole("button", { name: /Neighborhood/ });
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(screen.queryByTestId("mock-force-graph")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /graph depth/i })).not.toBeInTheDocument();
  });
});
