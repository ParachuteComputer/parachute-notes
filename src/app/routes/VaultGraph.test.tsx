import { VaultGraph } from "@/app/routes/VaultGraph";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the force graph lib — jsdom has no canvas, and we only care about
// the data/click wiring, not the actual rendering.
interface MockGraphData {
  nodes: Array<{ id: string; title: string }>;
  links: Array<{ source: string; target: string; rel?: string }>;
}

vi.mock("react-force-graph-2d", () => ({
  default: (props: {
    graphData: MockGraphData;
    onNodeClick: (n: { id: string }) => void;
    nodeColor?: (n: { id: string }) => string;
  }) => (
    <div data-testid="mock-force-graph">
      <span data-testid="node-count">{props.graphData.nodes.length}</span>
      <span data-testid="link-count">{props.graphData.links.length}</span>
      <ul>
        {props.graphData.nodes.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => props.onNodeClick(n)}
              data-color={props.nodeColor?.(n) ?? ""}
            >
              {n.title}
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
  localStorage.setItem(
    "lens:token:v1",
    JSON.stringify({ accessToken: "t", scope: "full", vault: "default" }),
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <MemoryRouter initialEntries={["/graph"]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/graph" element={children} />
          <Route path="/n/:id" element={<div data-testid="note-route" />} />
          <Route path="/new" element={<div data-testid="new-route" />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function installFetch(notes: unknown[]) {
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

describe("VaultGraph route", () => {
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

  const notes = [
    {
      id: "a",
      path: "Projects/Lens.md",
      createdAt: "2026-04-18T00:00:00.000Z",
      tags: ["project"],
      links: [{ sourceId: "a", targetId: "b", relationship: "wikilink" }],
    },
    {
      id: "b",
      path: "Canon/Uni.md",
      createdAt: "2026-04-18T00:00:00.000Z",
      tags: ["canon"],
      links: [],
    },
    {
      id: "c",
      path: "Journal/2026-04-18.md",
      createdAt: "2026-04-18T00:00:00.000Z",
      tags: [],
      links: [],
    },
  ];

  it("renders nodes and edges from the fetched notes", async () => {
    seedActiveVault();
    installFetch(notes);
    render(
      <Wrap>
        <VaultGraph />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByTestId("node-count").textContent).toBe("3"));
    expect(screen.getByTestId("link-count").textContent).toBe("1");
    expect(screen.getByRole("button", { name: "Lens" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uni" })).toBeInTheDocument();
    expect(screen.getByText("3 / 3 notes")).toBeInTheDocument();
  });

  it("search input narrows the matched count", async () => {
    seedActiveVault();
    installFetch(notes);
    render(
      <Wrap>
        <VaultGraph />
      </Wrap>,
    );
    await screen.findByTestId("mock-force-graph");

    fireEvent.change(screen.getByLabelText(/search graph nodes/i), {
      target: { value: "Lens" },
    });
    await waitFor(() => expect(screen.getByText("1 / 3 notes")).toBeInTheDocument());
  });

  it("toggling a tag chip filters matches", async () => {
    seedActiveVault();
    installFetch(notes);
    render(
      <Wrap>
        <VaultGraph />
      </Wrap>,
    );
    await screen.findByTestId("mock-force-graph");

    const canonChip = screen.getByRole("button", { name: "canon" });
    await act(async () => {
      fireEvent.click(canonChip);
    });
    expect(canonChip).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(screen.getByText("1 / 3 notes")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    });
    await waitFor(() => expect(screen.getByText("3 / 3 notes")).toBeInTheDocument());
  });

  it("clicking a node navigates to that note", async () => {
    seedActiveVault();
    installFetch(notes);
    render(
      <Wrap>
        <VaultGraph />
      </Wrap>,
    );
    const btn = await screen.findByRole("button", { name: "Lens" });
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(screen.getByTestId("note-route")).toBeInTheDocument());
  });

  it("shows the empty state when the vault has no notes", async () => {
    seedActiveVault();
    installFetch([]);
    render(
      <Wrap>
        <VaultGraph />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByText(/no notes yet/i)).toBeInTheDocument());
    expect(screen.queryByTestId("mock-force-graph")).not.toBeInTheDocument();
  });
});
