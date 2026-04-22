import { Tags } from "@/app/routes/Tags";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FetchState {
  tags: unknown[];
}

function installFetch(state: FetchState) {
  const impl = vi.fn<typeof fetch>(async () => {
    return {
      ok: true,
      status: 200,
      json: async () => state.tags,
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

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <MemoryRouter initialEntries={["/tags"]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/tags" element={children} />
          <Route path="/" element={<LocationSpy />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("Tags route", () => {
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

  it("renders tag chips sorted by count desc", async () => {
    installFetch({
      tags: [
        { name: "daily", count: 2 },
        { name: "canon", count: 9 },
        { name: "idea", count: 5 },
      ],
    });
    render(
      <Wrap>
        <Tags />
      </Wrap>,
    );
    const list = await screen.findByRole("list", { name: /tag list/i });
    const links = within(list).getAllByRole("link");
    expect(links.map((el) => el.textContent ?? "")).toEqual(["#canon9", "#idea5", "#daily2"]);
  });

  it("filters tags by the search input", async () => {
    installFetch({
      tags: [
        { name: "canon", count: 1 },
        { name: "journal", count: 2 },
        { name: "uni", count: 3 },
      ],
    });
    render(
      <Wrap>
        <Tags />
      </Wrap>,
    );
    await screen.findByRole("link", { name: /canon/i });
    fireEvent.change(screen.getByLabelText(/filter tags/i), { target: { value: "jour" } });
    expect(screen.queryByRole("link", { name: /canon/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /journal/i })).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 3 tags/i)).toBeInTheDocument();
  });

  it("toggling sort switches to alphabetical order", async () => {
    installFetch({
      tags: [
        { name: "zebra", count: 9 },
        { name: "apple", count: 1 },
      ],
    });
    render(
      <Wrap>
        <Tags />
      </Wrap>,
    );
    // Default: count desc — zebra first.
    let links = await screen.findAllByRole("link");
    expect(links[0]).toHaveTextContent("zebra");

    fireEvent.click(screen.getByRole("button", { name: /toggle tag sort/i }));
    links = await screen.findAllByRole("link");
    expect(links[0]).toHaveTextContent("apple");
  });

  it("clicking a tag navigates to /?tag=<name>", async () => {
    installFetch({ tags: [{ name: "daily", count: 3 }] });
    render(
      <Wrap>
        <Tags />
      </Wrap>,
    );
    const link = await screen.findByRole("link", { name: /daily/i });
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/?tag=daily"));
  });

  it("shows the empty state when there are no tags", async () => {
    installFetch({ tags: [] });
    render(
      <Wrap>
        <Tags />
      </Wrap>,
    );
    expect(await screen.findByText(/no tags in this vault yet/i)).toBeInTheDocument();
  });

  it("rename button opens a dialog and POSTs to the atomic rename endpoint", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const impl = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method, body });
      if (url.endsWith("/api/tags") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => [{ name: "work", count: 2 }],
        } as Response;
      }
      if (url.endsWith("/api/tags/work/rename") && method === "POST") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ renamed: 2 }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => [] } as Response;
    });
    vi.stubGlobal("fetch", impl);

    render(
      <Wrap>
        <Tags />
      </Wrap>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /rename tag work/i }));
    const input = await screen.findByLabelText(/new tag name/i);
    fireEvent.change(input, { target: { value: "projects" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => {
      expect(calls.some((c) => c.url.endsWith("/api/tags/work/rename"))).toBe(true);
    });
    const posts = calls.filter((c) => c.url.endsWith("/api/tags/work/rename"));
    expect(posts).toHaveLength(1);
    expect(posts[0]?.method).toBe("POST");
    expect(posts[0]?.body).toEqual({ new_name: "projects" });
  });

  it("merge requires 2+ selected tags before the merge button enables", async () => {
    installFetch({
      tags: [
        { name: "alpha", count: 1 },
        { name: "beta", count: 1 },
      ],
    });
    render(
      <Wrap>
        <Tags />
      </Wrap>,
    );
    await screen.findByRole("link", { name: /alpha/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /select tag alpha/i }));
    expect(screen.getByRole("button", { name: /merge into/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /select tag beta/i }));
    expect(screen.getByRole("button", { name: /merge into/i })).toBeEnabled();
  });

  it("pin toggle writes the per-vault pinned-tags list to localStorage", async () => {
    installFetch({ tags: [{ name: "daily", count: 4 }] });
    render(
      <Wrap>
        <Tags />
      </Wrap>,
    );
    const pin = await screen.findByRole("button", { name: /pin tag daily/i });
    expect(pin).toHaveTextContent(/pin/i);
    fireEvent.click(pin);
    const unpin = await screen.findByRole("button", { name: /unpin tag daily/i });
    expect(unpin).toHaveTextContent(/pinned/i);
    const stored = JSON.parse(localStorage.getItem("lens:pinned-tags:v1") ?? "[]");
    expect(stored).toEqual(["daily"]);
    fireEvent.click(unpin);
    await screen.findByRole("button", { name: /pin tag daily/i });
    expect(JSON.parse(localStorage.getItem("lens:pinned-tags:v1") ?? "[]")).toEqual([]);
  });

  it("shows the filtered-empty state when filter matches nothing", async () => {
    installFetch({ tags: [{ name: "canon", count: 1 }] });
    render(
      <Wrap>
        <Tags />
      </Wrap>,
    );
    await screen.findByRole("link", { name: /canon/i });
    fireEvent.change(screen.getByLabelText(/filter tags/i), { target: { value: "zzz" } });
    expect(await screen.findByText(/no tags match your filter/i)).toBeInTheDocument();
  });
});
