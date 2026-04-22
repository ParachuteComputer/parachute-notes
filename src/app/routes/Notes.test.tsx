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

function openFoldersAccordion() {
  const details = document
    .getElementById("notes-sidebar")
    ?.querySelector("details") as HTMLDetailsElement | null;
  if (!details) throw new Error("Folders accordion not found");
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
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
    window.history.replaceState({}, "", "/");
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

  it("pinned-first stable sort on default list view", async () => {
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
    const list = screen.getByRole("list", { name: "Notes" });
    const rows = within(list).getAllByRole("listitem");
    const firstRow = within(rows[0]!);
    expect(firstRow.getByText("pinned-note")).toBeInTheDocument();
    // Pin indicator visible on the pinned row.
    expect(firstRow.getByLabelText(/pinned/i)).toBeInTheDocument();
  });

  it("renders a Pinned tags strip on the home view when the vault has pinned tags", async () => {
    localStorage.setItem("lens:pinned-tags:dev", JSON.stringify(["daily", "idea"]));
    installFetch({
      notes: [],
      tags: [
        { name: "daily", count: 7 },
        { name: "idea", count: 3 },
      ],
    });

    render(<Notes />, { wrapper: Wrapper });

    // Strip buttons render as pressable chips, not links, so tag filters apply
    // in-place rather than routing away. Sidebar TagBrowser also renders a
    // #daily button — scope the query to the strip explicitly.
    const strip = await screen.findByRole("navigation", { name: /pinned tags/i });
    const dailyChip = within(strip).getByRole("button", { name: /#daily/i });
    expect(dailyChip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(dailyChip);
    await waitFor(() => expect(dailyChip).toHaveAttribute("aria-pressed", "true"));
  });

  it("omits the pinned-tags strip when no tags are pinned", async () => {
    installFetch({ notes: [], tags: [{ name: "daily", count: 2 }] });
    render(<Notes />, { wrapper: Wrapper });
    await screen.findByRole("list", { name: "Notes" }).catch(() => null);
    // The sidebar tag browser renders #daily too — scope to the strip.
    expect(screen.queryByRole("navigation", { name: /pinned tags/i })).not.toBeInTheDocument();
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

  it("renders the path tree once the auto threshold is met", async () => {
    // Five distinct top-level folders trips AUTO_TOP_LEVEL_MIN.
    installFetch({
      notes: ["A", "B", "C", "D", "E"].map((root, i) => ({
        id: `n${i}`,
        path: `${root}/note-${i}.md`,
        createdAt: "2026-04-18T10:00:00.000Z",
        updatedAt: "2026-04-18T10:00:00.000Z",
        tags: [],
      })),
      tags: [],
    });

    render(<Notes />, { wrapper: Wrapper });

    // Folders accordion is collapsed by default — the tree is lazy-fetched
    // on open.
    await screen.findByText("A/note-0.md");
    openFoldersAccordion();
    expect(await screen.findByRole("complementary", { name: /path tree/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^A\b/ })).toBeInTheDocument();
  });

  it("hides the path tree when auto threshold is not met", async () => {
    installFetch({
      notes: [
        {
          id: "n1",
          path: "Solo/note.md",
          createdAt: "2026-04-18T10:00:00.000Z",
          tags: [],
        },
      ],
      tags: [],
    });

    render(<Notes />, { wrapper: Wrapper });

    await screen.findByText("Solo/note.md");
    expect(screen.queryByRole("complementary", { name: /path tree/i })).toBeNull();
  });

  it("mode=always renders the tree even on a tag-flat vault", async () => {
    localStorage.setItem("lens:path-tree:dev", JSON.stringify({ mode: "always" }));
    installFetch({
      notes: [
        {
          id: "n1",
          path: "Solo/note.md",
          createdAt: "2026-04-18T10:00:00.000Z",
          tags: [],
        },
      ],
      tags: [],
    });

    render(<Notes />, { wrapper: Wrapper });
    await screen.findByText("Solo/note.md");
    openFoldersAccordion();
    expect(await screen.findByRole("complementary", { name: /path tree/i })).toBeInTheDocument();
  });

  it("mode=never skips the path-tree fetch and hides the tree", async () => {
    localStorage.setItem("lens:path-tree:dev", JSON.stringify({ mode: "never" }));
    const fetchImpl = installFetch({
      notes: ["A", "B", "C", "D", "E"].map((root, i) => ({
        id: `n${i}`,
        path: `${root}/note.md`,
        createdAt: "2026-04-18T10:00:00.000Z",
        tags: [],
      })),
      tags: [],
    });

    render(<Notes />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes("/api/notes"))).toBe(true);
    });
    // Two /api/notes queries fire when the tree is enabled (one filtered, one
    // capped). When `never`, only the filtered list query goes out — so the
    // unfiltered limit=5000 capped query should be absent.
    const treeCall = fetchImpl.mock.calls.find((c) => {
      const u = String(c[0]);
      return u.includes("/api/notes") && u.includes("limit=5000");
    });
    expect(treeCall).toBeUndefined();
    expect(screen.queryByRole("complementary", { name: /path tree/i })).toBeNull();
  });

  it("preset=untagged sends has_tags=false and hides the tag filter", async () => {
    const fetchImpl = installFetch({ notes: [], tags: [] });
    render(<Notes preset="untagged" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(lastNotesUrl(fetchImpl)).toContain("has_tags=false");
    });
    expect(screen.getByRole("heading", { name: "Untagged" })).toBeInTheDocument();
    // Tag filter is hidden — its summary disclosure is gone.
    expect(screen.queryByText(/^Tags$/)).not.toBeInTheDocument();
  });

  it("preset=orphaned sends has_links=false", async () => {
    const fetchImpl = installFetch({ notes: [], tags: [] });
    render(<Notes preset="orphaned" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(lastNotesUrl(fetchImpl)).toContain("has_links=false");
    });
    expect(screen.getByRole("heading", { name: "Orphaned" })).toBeInTheDocument();
  });

  it("untagged row has a quick-tag control that PATCHes the note with tags.add", async () => {
    const updated = {
      id: "n1",
      path: "Inbox/loose-thought",
      tags: ["project"],
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    };
    const patchCalls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PATCH") {
        patchCalls.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return {
          ok: true,
          status: 200,
          json: async () => updated,
          text: async () => "",
        } as Response;
      }
      const body = url.includes("/api/tags")
        ? [{ name: "project", count: 5 }]
        : [
            {
              id: "n1",
              path: "Inbox/loose-thought",
              tags: [],
              createdAt: "2026-04-18T10:00:00.000Z",
              updatedAt: "2026-04-18T10:00:00.000Z",
            },
          ];
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => "",
      } as Response;
    });
    vi.stubGlobal("fetch", fetchImpl);

    render(<Notes preset="untagged" />, { wrapper: Wrapper });

    await screen.findByText("Inbox/loose-thought");
    fireEvent.click(screen.getByRole("button", { name: /add tag/i }));

    const tagInput = await screen.findByLabelText(/tag name/i);
    fireEvent.change(tagInput, { target: { value: "project" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });

    await waitFor(() => {
      expect(patchCalls.length).toBe(1);
    });
    expect(patchCalls[0]?.url).toMatch(/\/api\/notes\/n1$/);
    expect(patchCalls[0]?.body).toEqual({ tags: { add: ["project"] } });
  });

  it("sidebar renders the tag browser above the collapsed Folders details", async () => {
    installFetch({
      notes: ["A", "B", "C", "D", "E"].map((root, i) => ({
        id: `n${i}`,
        path: `${root}/note-${i}.md`,
        createdAt: "2026-04-18T10:00:00.000Z",
        tags: [],
      })),
      tags: [{ name: "idea", count: 2 }],
    });

    render(<Notes />, { wrapper: Wrapper });

    const tagNav = await screen.findByRole("navigation", { name: /browse by tag/i });
    const sidebar = document.getElementById("notes-sidebar");
    expect(sidebar).not.toBeNull();
    expect(sidebar?.contains(tagNav)).toBe(true);
    // Folders is now a collapsed <details>. Waits for the async path-tree
    // fetch to settle before the wrapper is mounted.
    const details = await waitFor(() => {
      const d = (sidebar as HTMLElement).querySelector("details");
      expect(d).not.toBeNull();
      return d as HTMLDetailsElement;
    });
    expect(details.open).toBe(false);
    const summary = details.querySelector("summary");
    expect(summary?.textContent).toContain("Folders");
    // Tag-browser nav appears earlier in document order than the Folders group.
    const comparison = tagNav.compareDocumentPosition(details);
    expect(comparison & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("clicking a tree folder writes path_prefix to the URL", async () => {
    const fetchImpl = installFetch({
      notes: ["Canon", "B", "C", "D", "E"].map((root, i) => ({
        id: `n${i}`,
        path: `${root}/note-${i}.md`,
        createdAt: "2026-04-18T10:00:00.000Z",
        tags: [],
      })),
      tags: [],
    });

    render(<Notes />, { wrapper: Wrapper });

    // Folders accordion starts closed; open it so the tree query fires.
    await screen.findByText("Canon/note-0.md");
    openFoldersAccordion();

    const canonNode = await screen.findByRole("button", { name: /^Canon\b/ });
    fireEvent.click(canonNode);

    await waitFor(() => {
      expect(window.location.search).toContain("path_prefix=Canon");
    });
    await waitFor(() => {
      expect(lastNotesUrl(fetchImpl)).toContain("path_prefix=Canon");
    });
  });

  it("does not fetch the path-tree query while the Folders accordion is closed", async () => {
    const fetchImpl = installFetch({
      notes: ["A", "B", "C", "D", "E"].map((root, i) => ({
        id: `n${i}`,
        path: `${root}/note-${i}.md`,
        createdAt: "2026-04-18T10:00:00.000Z",
        tags: [],
      })),
      tags: [],
    });

    render(<Notes />, { wrapper: Wrapper });

    // Wait for the main notes list to settle so we know queries had a chance.
    await screen.findByText("A/note-0.md");

    const pathTreeCalls = fetchImpl.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("/api/notes") && u.includes("limit=5000"));
    expect(pathTreeCalls.length).toBe(0);

    // Opening the accordion should trigger the fetch.
    openFoldersAccordion();

    await waitFor(() => {
      const after = fetchImpl.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes("/api/notes") && u.includes("limit=5000"));
      expect(after.length).toBeGreaterThan(0);
    });
  });
});
