import { NoteNew } from "@/app/routes/NoteNew";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/CodeMirrorEditor", () => ({
  CodeMirrorEditor: ({
    value,
    onChange,
  }: { value: string; onChange(next: string): void; onSave?(): void; onCancel?(): void }) => (
    <textarea data-testid="cm-editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

interface FetchEntry {
  status?: number;
  body: unknown;
  text?: string;
}
type FetchMap = Record<string, FetchEntry | FetchEntry[]>;

function installFetch(map: FetchMap) {
  const cursors = new Map<string, number>();
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
      const list = Array.isArray(entry) ? entry : [entry];
      const idx = Math.min(cursors.get(matcher) ?? 0, list.length - 1);
      cursors.set(matcher, idx + 1);
      const hit = list[idx]!;
      return {
        ok: (hit.status ?? 200) < 400,
        status: hit.status ?? 200,
        json: async () => hit.body,
        text: async () => hit.text ?? "",
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

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/new" element={<NoteNew />} />
        <Route path="/notes/:id" element={<div>NoteViewPage</div>} />
        <Route path="/notes" element={<div>NotesListPage</div>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: Wrapper },
  );
}

describe("NoteNew route", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    seedStore();
    vi.spyOn(window, "confirm").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Create is disabled until both path and content are present", async () => {
    installFetch({});
    renderAt("/new");

    const create = screen.getByRole("button", { name: /^create$/i });
    expect(create).toBeDisabled();

    const pathInput = screen.getByLabelText(/note path/i);
    fireEvent.change(pathInput, { target: { value: "Projects/README" } });
    expect(create).toBeDisabled(); // still need content

    const cm = screen.getByTestId("cm-editor");
    fireEvent.change(cm, { target: { value: "# hello" } });
    expect(create).not.toBeDisabled();
  });

  it("happy path: POSTs payload and navigates to /notes/<new-id>", async () => {
    const fetchImpl = installFetch({
      "POST /api/notes": {
        status: 201,
        body: {
          id: "new-note-id",
          path: "Projects/README",
          createdAt: "2026-04-18T12:00:00Z",
          content: "# hi",
          tags: ["docs"],
        },
      },
    });

    renderAt("/new");

    fireEvent.change(screen.getByLabelText(/note path/i), {
      target: { value: "Projects/README" },
    });
    fireEvent.change(screen.getByLabelText(/note summary/i), {
      target: { value: "A readme" },
    });
    const tagInput = screen.getByLabelText(/add tag/i);
    fireEvent.change(tagInput, { target: { value: "docs" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });
    fireEvent.change(screen.getByTestId("cm-editor"), { target: { value: "# hi" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    });

    await waitFor(() => {
      expect(screen.getByText("NoteViewPage")).toBeInTheDocument();
    });

    const postCall = fetchImpl.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body).toEqual({
      content: "# hi",
      path: "Projects/README",
      tags: ["docs"],
      metadata: { summary: "A readme" },
    });

    expect(useToastStore.getState().toasts[0]?.message).toContain("Created");
  });

  it("duplicate path: error is visible and content/path are preserved", async () => {
    installFetch({
      "POST /api/notes": {
        status: 500,
        body: null,
        text: '{"error":"Internal server error"}',
      },
    });

    renderAt("/new");

    fireEvent.change(screen.getByLabelText(/note path/i), { target: { value: "dup" } });
    fireEvent.change(screen.getByTestId("cm-editor"), { target: { value: "keep me" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/500|path is taken/i);
    expect((screen.getByLabelText(/note path/i) as HTMLInputElement).value).toBe("dup");
    expect((screen.getByTestId("cm-editor") as HTMLTextAreaElement).value).toBe("keep me");
  });
});
