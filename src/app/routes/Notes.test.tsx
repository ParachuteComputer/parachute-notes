import { Notes } from "@/app/routes/Notes";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FetchState {
  notes: unknown[];
  tags: unknown[];
}

function installFetch(state: FetchState) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = url.includes("/api/tags") ? state.tags : state.notes;
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => "",
    } as Response;
  });
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

function seedStore() {
  // Directly mutate zustand state so we don't touch localStorage.
  useVaultStore.setState({
    vaults: {
      dev: {
        id: "dev",
        url: "http://localhost:1940",
        name: "dev",
        issuer: "http://localhost:1940",
        clientId: "client-test",
        scope: "full",
        addedAt: "2026-04-18T00:00:00.000Z",
        lastUsedAt: "2026-04-18T00:00:00.000Z",
      },
    },
    activeVaultId: "dev",
  });
  localStorage.setItem(
    "lens:token:dev",
    JSON.stringify({ accessToken: "pvt_abc", scope: "full", vault: "default" }),
  );
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  );
}

function lastNotesUrl(fetchImpl: ReturnType<typeof installFetch>): string {
  // The saved-views sidebar also queries /api/notes (tag=view & views path
  // prefix). Filter those out so assertions target the primary list query.
  const calls = fetchImpl.mock.calls.map((c) => String(c[0]));
  const noteCalls = calls.filter(
    (u) => u.includes("/api/notes") && !u.includes("path_prefix=UI%2FViews%2F"),
  );
  return noteCalls[noteCalls.length - 1] ?? "";
}

describe("Notes route", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
    // BrowserRouter reads from window.history, which persists across tests.
    // Reset so URL-driven filter state doesn't leak between cases.
    window.history.replaceState({}, "", "/notes");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders fetched notes with path, preview, tags, and relative time", async () => {
    installFetch({
      notes: [
        {
          id: "n1",
          path: "Projects/lens/README",
          preview: "A lens onto any Parachute Vault.",
          tags: ["project"],
          createdAt: "2026-04-18T10:00:00.000Z",
          updatedAt: "2026-04-18T11:00:00.000Z",
        },
      ],
      tags: [{ name: "project", count: 1 }],
    });

    render(<Notes />, { wrapper: Wrapper });

    const pathLink = await screen.findByText("Projects/lens/README");
    expect(pathLink).toBeInTheDocument();
    expect(screen.getByText(/A lens onto any Parachute Vault\./)).toBeInTheDocument();
    // Tag chip should live inside the same row as the path.
    const row = pathLink.closest("li");
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("project");
  });

  it("debounces the search input and sends the search param after 300ms", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchImpl = installFetch({ notes: [], tags: [] });

    render(<Notes />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes("/api/notes"))).toBe(true);
    });

    const input = screen.getByLabelText(/search notes/i);
    fireEvent.change(input, { target: { value: "hello" } });

    // Debounce: no search= yet right after typing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(lastNotesUrl(fetchImpl)).not.toContain("search=hello");

    // After the full debounce window, the search param lands on the URL.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => {
      expect(lastNotesUrl(fetchImpl)).toContain("search=hello");
    });
  });

  it("toggles sort direction via the header button", async () => {
    const fetchImpl = installFetch({ notes: [], tags: [] });
    render(<Notes />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(lastNotesUrl(fetchImpl)).toContain("sort=desc");
    });

    fireEvent.click(screen.getByRole("button", { name: /toggle sort/i }));

    await waitFor(() => {
      expect(lastNotesUrl(fetchImpl)).toContain("sort=asc");
    });
  });

  it("shows empty state when no notes and no active filters", async () => {
    installFetch({ notes: [], tags: [] });
    render(<Notes />, { wrapper: Wrapper });
    expect(await screen.findByText(/this vault has no notes yet/i)).toBeInTheDocument();
  });

  it("shows filtered-empty state and hides the zero-vault copy", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installFetch({ notes: [], tags: [] });
    render(<Notes />, { wrapper: Wrapper });

    fireEvent.change(screen.getByLabelText(/search notes/i), { target: { value: "xyz" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(await screen.findByText(/no notes match these filters/i)).toBeInTheDocument();
  });

  it("pinned-first stable sort on default /notes", async () => {
    installFetch({
      notes: [
        {
          id: "a",
          path: "plain-one",
          tags: [],
          createdAt: "2026-04-18T10:00:00.000Z",
          updatedAt: "2026-04-18T11:00:00.000Z",
        },
        {
          id: "b",
          path: "pinned-note",
          tags: ["pinned"],
          createdAt: "2026-04-18T09:00:00.000Z",
          updatedAt: "2026-04-18T09:00:00.000Z",
        },
        {
          id: "c",
          path: "plain-two",
          tags: [],
          createdAt: "2026-04-18T08:00:00.000Z",
          updatedAt: "2026-04-18T08:00:00.000Z",
        },
      ],
      tags: [],
    });

    render(<Notes />, { wrapper: Wrapper });

    await screen.findByText("pinned-note");
    const rows = screen.getAllByRole("listitem");
    const firstRow = within(rows[0]!);
    expect(firstRow.getByText("pinned-note")).toBeInTheDocument();
    // Pin indicator visible on the pinned row.
    expect(firstRow.getByLabelText(/pinned/i)).toBeInTheDocument();
  });

  it("hides archived notes by default and shows them when toggled on", async () => {
    installFetch({
      notes: [
        {
          id: "a",
          path: "live-note",
          tags: [],
          createdAt: "2026-04-18T10:00:00.000Z",
        },
        {
          id: "b",
          path: "archived-note",
          tags: ["archived"],
          createdAt: "2026-04-18T09:00:00.000Z",
        },
      ],
      tags: [],
    });

    render(<Notes />, { wrapper: Wrapper });

    await screen.findByText("live-note");
    expect(screen.queryByText("archived-note")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/show archived/i));
    await waitFor(() => {
      expect(screen.getByText("archived-note")).toBeInTheDocument();
    });
  });

  it("preset=pinned sends the pinned role tag and hides the show-archived toggle", async () => {
    const fetchImpl = installFetch({ notes: [], tags: [] });
    render(<Notes preset="pinned" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(lastNotesUrl(fetchImpl)).toContain("tag=pinned");
    });
    expect(screen.queryByLabelText(/show archived/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pinned" })).toBeInTheDocument();
  });

  it("preset=archived sends the archived role tag", async () => {
    const fetchImpl = installFetch({ notes: [], tags: [] });
    render(<Notes preset="archived" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(lastNotesUrl(fetchImpl)).toContain("tag=archived");
    });
    expect(screen.getByRole("heading", { name: "Archived" })).toBeInTheDocument();
  });
});
