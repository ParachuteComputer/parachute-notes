import { Notes } from "@/app/routes/Notes";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FetchState {
  notes: unknown[];
  tags: unknown[];
  views: unknown[];
}

function installFetch(state: FetchState) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PATCH" || method === "DELETE") {
      const id = url.match(/\/api\/notes\/([^?]+)/)?.[1] ?? "x";
      return {
        ok: true,
        status: 200,
        json: async () => ({ id, path: `UI/Views/${id}`, createdAt: "2026-04-26T00:00:00Z" }),
        text: async () => "",
      } as Response;
    }
    if (url.includes("/api/tags")) {
      return {
        ok: true,
        status: 200,
        json: async () => state.tags,
        text: async () => "",
      } as Response;
    }
    // Saved-views are filtered by `path_prefix=UI%2FViews%2F` on the request.
    const isViewsQuery = url.includes("path_prefix=UI%2FViews%2F");
    const body = isViewsQuery ? state.views : state.notes;
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
  useVaultStore.setState({
    vaults: {
      dev: {
        id: "dev",
        url: "http://localhost:1940",
        name: "dev",
        issuer: "http://localhost:1940",
        clientId: "client-test",
        scope: "full",
        addedAt: "2026-04-25T00:00:00.000Z",
        lastUsedAt: "2026-04-25T00:00:00.000Z",
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  );
}

const viewNote = {
  id: "view-1",
  path: "UI/Views/Daily",
  createdAt: "2026-04-25T00:00:00Z",
  updatedAt: "2026-04-25T10:00:00Z",
  metadata: { kind: "saved-view", filters: { tags: ["journal"] } },
};

describe("SavedViewsSidebar management menu", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    seedStore();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders saved views with a per-row management menu trigger", async () => {
    installFetch({ notes: [], tags: [], views: [viewNote] });

    render(<Notes />, { wrapper: Wrapper });

    const list = await screen.findByRole("list", { name: /saved views/i });
    const item = within(list).getByText("Daily").closest("li") as HTMLElement;
    expect(item).not.toBeNull();
    const trigger = within(item).getByRole("button", { name: /manage saved view daily/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the menu and disables 'Update with current filters' when no filters are active", async () => {
    installFetch({ notes: [], tags: [], views: [viewNote] });

    render(<Notes />, { wrapper: Wrapper });
    const trigger = await screen.findByRole("button", { name: /manage saved view daily/i });
    fireEvent.click(trigger);

    const update = await screen.findByRole("menuitem", { name: /update with current filters/i });
    expect(update).toBeDisabled();
  });

  it("Delete sends DELETE to the view note id when confirmed", async () => {
    const fetchImpl = installFetch({ notes: [], tags: [], views: [viewNote] });
    vi.stubGlobal("confirm", () => true);

    render(<Notes />, { wrapper: Wrapper });
    const trigger = await screen.findByRole("button", { name: /manage saved view daily/i });
    fireEvent.click(trigger);

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /^delete$/i }));
    });

    await waitFor(() => {
      const del = fetchImpl.mock.calls.find(
        ([url, init]) =>
          (init as RequestInit | undefined)?.method === "DELETE" &&
          String(url).includes("/api/notes/view-1"),
      );
      expect(del).toBeDefined();
    });
  });

  it("Delete is a no-op when the user cancels the confirm prompt", async () => {
    const fetchImpl = installFetch({ notes: [], tags: [], views: [viewNote] });
    vi.stubGlobal("confirm", () => false);

    render(<Notes />, { wrapper: Wrapper });
    const trigger = await screen.findByRole("button", { name: /manage saved view daily/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /^delete$/i }));

    // Give react-query a microtask in case the mutation queued anyway.
    await act(async () => {
      await Promise.resolve();
    });
    const del = fetchImpl.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
    );
    expect(del).toBeUndefined();
  });

  it("Rename opens a dialog and PATCHes the new path on save", async () => {
    const fetchImpl = installFetch({ notes: [], tags: [], views: [viewNote] });

    render(<Notes />, { wrapper: Wrapper });
    const trigger = await screen.findByRole("button", { name: /manage saved view daily/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /rename/i }));

    const dialog = await screen.findByRole("dialog", { name: /rename view/i });
    const input = within(dialog).getByLabelText(/view name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Weekly" } });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    });

    await waitFor(() => {
      const patch = fetchImpl.mock.calls.find(
        ([url, init]) =>
          (init as RequestInit | undefined)?.method === "PATCH" &&
          String(url).includes("/api/notes/view-1"),
      );
      expect(patch).toBeDefined();
      const body = JSON.parse((patch?.[1] as RequestInit).body as string);
      expect(body.path).toBe("UI/Views/Weekly");
      expect(body.if_updated_at).toBe("2026-04-25T10:00:00Z");
    });
  });
});
