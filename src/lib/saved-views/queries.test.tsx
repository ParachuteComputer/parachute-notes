import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDeleteView, useRenameView, useSavedViews, useUpdateView } from "./queries";
import type { SavedView } from "./spec";

interface FetchEntry {
  status?: number;
  body: unknown;
}
type FetchMap = Record<string, FetchEntry>;

function installFetch(map: FetchMap) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    for (const matcher of Object.keys(map)) {
      const [wantMethod, wantFragment] = matcher.includes(" ")
        ? matcher.split(" ", 2)
        : ["GET", matcher];
      if (method !== wantMethod) continue;
      if (!url.includes(wantFragment!)) continue;
      const entry = map[matcher]!;
      return {
        ok: (entry.status ?? 200) < 400,
        status: entry.status ?? 200,
        json: async () => entry.body,
        text: async () => "",
      } as Response;
    }
    return { ok: false, status: 404, json: async () => null, text: async () => "" } as Response;
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
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const baseView: SavedView = {
  id: "view-1",
  name: "Daily",
  filters: { tags: ["journal"] },
  updatedAt: "2026-04-25T10:00:00.000Z",
};

describe("saved-views mutations", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("useSavedViews exposes updatedAt so mutations can send if_updated_at", async () => {
    installFetch({
      "/api/notes?tag=view": {
        body: [
          {
            id: "view-1",
            path: "UI/Views/Daily",
            createdAt: "2026-04-25T00:00:00Z",
            updatedAt: "2026-04-25T10:00:00.000Z",
            metadata: { kind: "saved-view", filters: { tags: ["journal"] } },
          },
        ],
      },
    });

    const { result } = renderHook(() => useSavedViews("view"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.[0]?.updatedAt).toBe("2026-04-25T10:00:00.000Z");
  });

  it("useRenameView PATCHes the new path with if_updated_at when a baseline is present", async () => {
    const fetchImpl = installFetch({
      "PATCH /api/notes/view-1": {
        body: { id: "view-1", path: "UI/Views/Renamed", createdAt: "2026-04-25T00:00:00Z" },
      },
    });

    const { result } = renderHook(() => useRenameView(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ view: baseView, newName: "Renamed" });
    });

    const patch = fetchImpl.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patch).toBeDefined();
    const body = JSON.parse((patch?.[1] as RequestInit).body as string);
    expect(body.path).toBe("UI/Views/Renamed");
    expect(body.if_updated_at).toBe("2026-04-25T10:00:00.000Z");
    expect(body.force).toBeUndefined();
  });

  it("useRenameView falls back to force when the view has no updatedAt baseline", async () => {
    const fetchImpl = installFetch({
      "PATCH /api/notes/view-1": {
        body: { id: "view-1", path: "UI/Views/X", createdAt: "2026-04-25T00:00:00Z" },
      },
    });
    const noBaseline: SavedView = { ...baseView, updatedAt: undefined };

    const { result } = renderHook(() => useRenameView(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ view: noBaseline, newName: "X" });
    });

    const patch = fetchImpl.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
    );
    const body = JSON.parse((patch?.[1] as RequestInit).body as string);
    expect(body.force).toBe(true);
    expect(body.if_updated_at).toBeUndefined();
  });

  it("useUpdateView re-encodes the metadata against the current filters", async () => {
    const fetchImpl = installFetch({
      "PATCH /api/notes/view-1": {
        body: { id: "view-1", path: "UI/Views/Daily", createdAt: "2026-04-25T00:00:00Z" },
      },
    });

    const { result } = renderHook(() => useUpdateView(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        view: baseView,
        filters: { search: "draft", tags: ["a", "b"], tagMatch: "all" },
      });
    });

    const patch = fetchImpl.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
    );
    const body = JSON.parse((patch?.[1] as RequestInit).body as string);
    expect(body.metadata).toEqual({
      kind: "saved-view",
      filters: { search: "draft", tags: ["a", "b"], tagMatch: "all" },
    });
    expect(body.if_updated_at).toBe("2026-04-25T10:00:00.000Z");
  });

  it("useDeleteView fires DELETE against the view note id", async () => {
    const fetchImpl = installFetch({
      "DELETE /api/notes/view-1": { body: { deleted: true, id: "view-1" } },
    });

    const { result } = renderHook(() => useDeleteView(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync(baseView);
    });

    const del = fetchImpl.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
    );
    expect(del?.[0]).toContain("/api/notes/view-1");
  });
});
