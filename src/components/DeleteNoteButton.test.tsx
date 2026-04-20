import { DeleteNoteButton } from "@/components/DeleteNoteButton";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import type { Note } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const note: Note = {
  id: "note-abc",
  path: "Canon/Aaron",
  createdAt: "2026-04-16T00:00:00Z",
  updatedAt: "2026-04-17T00:00:00Z",
  tags: [],
};

function renderButton() {
  return render(
    <MemoryRouter initialEntries={["/n/note-abc"]}>
      <Routes>
        <Route path="/n/note-abc" element={<DeleteNoteButton note={note} />} />
        <Route path="/" element={<div>NotesListPage</div>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: Wrapper },
  );
}

describe("DeleteNoteButton", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    seedStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("single click opens the confirmation dialog but does not delete", async () => {
    const fetchImpl = installFetch({});
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
      ),
    ).toBe(false);
  });

  it("confirm button stays disabled until path is typed exactly; Enter without match is no-op", async () => {
    const fetchImpl = installFetch({
      "DELETE /api/notes/": { body: { deleted: true, id: "note-abc" } },
    });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    const confirm = screen.getByRole("button", { name: /delete permanently/i });
    expect(confirm).toBeDisabled();

    const input = screen.getByLabelText(/type note path to confirm/i);

    // Enter with partial text doesn't trigger delete.
    fireEvent.change(input, { target: { value: "Canon/" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(confirm).toBeDisabled();
    expect(
      fetchImpl.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
      ),
    ).toBe(false);

    fireEvent.change(input, { target: { value: "Canon/Aaron" } });
    expect(confirm).not.toBeDisabled();
  });

  it("happy path: fires DELETE, navigates to /, pushes a success toast", async () => {
    const fetchImpl = installFetch({
      "DELETE /api/notes/": { body: { deleted: true, id: "note-abc" } },
    });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    fireEvent.change(screen.getByLabelText(/type note path to confirm/i), {
      target: { value: "Canon/Aaron" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /delete permanently/i }));
    });

    await waitFor(() => {
      expect(screen.getByText("NotesListPage")).toBeInTheDocument();
    });

    const deleteCall = fetchImpl.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
    );
    expect(deleteCall?.[0]).toContain("/api/notes/note-abc");
    expect(useToastStore.getState().toasts[0]?.message).toContain("Deleted Canon/Aaron");
  });
});
