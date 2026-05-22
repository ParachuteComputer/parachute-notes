import { NoteEditor } from "@/app/routes/NoteEditor";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Swap CodeMirror out for a plain textarea so tests can drive onChange without
// wrangling CM6 inside jsdom.
vi.mock("@/components/CodeMirrorEditor", async () => {
  const React = await import("react");
  return {
    CodeMirrorEditor: React.forwardRef(function MockCodeMirrorEditor(
      props: {
        value: string;
        onChange(next: string): void;
        onSave?(): void;
        onCancel?(): void;
        onPasteFile?(files: File[]): boolean;
      },
      ref: React.Ref<{ insertAtCursor(s: string): void; focus(): void }>,
    ) {
      const { value, onChange, onPasteFile } = props;
      React.useImperativeHandle(
        ref,
        () => ({
          insertAtCursor(s: string) {
            onChange(value + s);
          },
          focus() {},
        }),
        [value, onChange],
      );
      return (
        <>
          <textarea
            data-testid="cm-editor"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <button
            type="button"
            data-testid="cm-paste-image"
            onClick={() => {
              const f = new File([new Uint8Array([1, 2])], "pasted.png", { type: "image/png" });
              onPasteFile?.([f]);
            }}
          >
            mock paste
          </button>
        </>
      );
    }),
  };
});

class FakeXhrUpload {
  onprogress: ((e: ProgressEvent) => void) | null = null;
}

class FakeXhr {
  method = "";
  url = "";
  body: Document | XMLHttpRequestBodyInit | null = null;
  status = 0;
  responseText = "";
  headers: Record<string, string> = {};
  upload = new FakeXhrUpload();
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
  resolve(status: number, body: string) {
    this.status = status;
    this.responseText = body;
    this.onload?.();
  }
}

function installXhr(): FakeXhr[] {
  const xhrs: FakeXhr[] = [];
  vi.stubGlobal(
    "XMLHttpRequest",
    // biome-ignore lint/complexity/useArrowFunction: must be `new`-able
    function () {
      const x = new FakeXhr();
      xhrs.push(x);
      return x;
    } as unknown as typeof XMLHttpRequest,
  );
  return xhrs;
}

interface FetchEntry {
  status?: number;
  body: unknown;
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

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/n/:id/edit" element={<NoteEditor />} />
        <Route path="/n/:id" element={<div>NoteViewPage</div>} />
        <Route path="/" element={<div>NotesListPage</div>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: Wrapper },
  );
}

const baseNote = {
  id: "abc-123",
  path: "Canon/Aaron",
  createdAt: "2026-04-16T00:00:00Z",
  updatedAt: "2026-04-17T00:00:00Z",
  content: "# hi\n\nbody",
  tags: ["canon"],
  links: [],
  attachments: [],
};

describe("NoteEditor route", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    seedStore();
    // jsdom doesn't implement confirm; default it to true so paths that gate
    // on user approval proceed.
    vi.spyOn(window, "confirm").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the editor seeded from the note and shows Save disabled until dirty", async () => {
    installFetch({ "/api/notes": { body: baseNote } });
    renderAt("/n/abc-123/edit");

    const cm = (await screen.findByTestId("cm-editor")) as HTMLTextAreaElement;
    expect(cm.value).toBe(baseNote.content);
    const save = screen.getByRole("button", { name: /save/i });
    expect(save).toBeDisabled();
    expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument();
  });

  it("marks dirty on typing, saves with if_updated_at and changed fields, clears dirty on success", async () => {
    const updated = {
      ...baseNote,
      content: "# hi\n\nbody more",
      tags: ["canon", "draft"],
      updatedAt: "2026-04-18T09:00:00Z",
    };
    const fetchImpl = installFetch({
      "GET /api/notes": { body: baseNote },
      "PATCH /api/notes/": { body: updated },
    });

    renderAt("/n/abc-123/edit");
    const cm = (await screen.findByTestId("cm-editor")) as HTMLTextAreaElement;

    fireEvent.change(cm, { target: { value: "# hi\n\nbody more" } });

    const tagInput = screen.getByLabelText(/add tag/i) as HTMLInputElement;
    fireEvent.change(tagInput, { target: { value: "draft" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });

    expect(screen.getByText(/unsaved/i)).toBeInTheDocument();

    const save = screen.getByRole("button", { name: /save/i });
    expect(save).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(save);
    });

    await waitFor(() => {
      expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument();
    });

    const patchCall = fetchImpl.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patchCall).toBeDefined();
    const body = JSON.parse((patchCall![1] as RequestInit).body as string);
    expect(body.content).toBe("# hi\n\nbody more");
    expect(body.if_updated_at).toBe(baseNote.updatedAt);
    expect(body.tags).toEqual({ add: ["draft"], remove: [] });
    expect(body.path).toBeUndefined();
  });

  it("Revert resets draft back to baseline and clears dirty", async () => {
    installFetch({ "/api/notes": { body: baseNote } });
    renderAt("/n/abc-123/edit");

    const cm = (await screen.findByTestId("cm-editor")) as HTMLTextAreaElement;
    fireEvent.change(cm, { target: { value: "changed" } });
    expect(screen.getByText(/unsaved/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /revert/i }));
    });
    expect(cm.value).toBe(baseNote.content);
    expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument();
  });

  it("shows the conflict banner when the server returns 409", async () => {
    installFetch({
      "GET /api/notes": { body: baseNote },
      "PATCH /api/notes/": {
        status: 409,
        body: {
          message: "Note was modified",
          current_updated_at: "2026-04-18T10:00:00Z",
          expected_updated_at: baseNote.updatedAt,
        },
      },
    });

    renderAt("/n/abc-123/edit");
    const cm = (await screen.findByTestId("cm-editor")) as HTMLTextAreaElement;
    fireEvent.change(cm, { target: { value: "stale edit" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
    });

    expect(await screen.findByText(/edited elsewhere/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload latest/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /keep editing/i })).toBeInTheDocument();
    // Draft is preserved — user keeps their unsaved content.
    expect(cm.value).toBe("stale edit");
  });

  it("path edit surfaces the rename warning", async () => {
    installFetch({ "/api/notes": { body: baseNote } });
    renderAt("/n/abc-123/edit");

    const pathInput = (await screen.findByLabelText(/note path/i)) as HTMLInputElement;
    fireEvent.change(pathInput, { target: { value: "Canon/Aaron-v2" } });
    expect(screen.getByText(/renaming moves the note/i)).toBeInTheDocument();
  });

  it("drop file → uploads, inserts markdown, and links to the existing note", async () => {
    const fetchImpl = installFetch({
      "GET /api/notes": { body: baseNote },
      "POST /api/notes/abc-123/attachments": {
        status: 201,
        body: {
          id: "att-1",
          noteId: "abc-123",
          path: "2026-04-18/shot.png",
          mimeType: "image/png",
        },
      },
    });
    const xhrs = installXhr();
    renderAt("/n/abc-123/edit");

    const cm = await screen.findByTestId("cm-editor");
    const dropZone = cm.closest("div.relative");
    expect(dropZone).not.toBeNull();

    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
    const dataTransfer = {
      files: [file],
      items: [{ kind: "file" }],
      types: ["Files"],
      dropEffect: "copy",
    } as unknown as DataTransfer;

    fireEvent.drop(dropZone!, { dataTransfer });

    await waitFor(() => expect(xhrs.length).toBe(1));
    expect(xhrs[0]!.url).toBe("http://localhost:1940/api/storage/upload");

    await act(async () => {
      xhrs[0]!.resolve(
        201,
        JSON.stringify({ path: "2026-04-18/shot.png", size: 3, mimeType: "image/png" }),
      );
    });

    await waitFor(() => {
      expect((cm as HTMLTextAreaElement).value).toContain(
        "![shot.png](/api/storage/2026-04-18/shot.png)",
      );
    });

    await waitFor(() => {
      const linkCall = fetchImpl.mock.calls.find(([url, init]) => {
        const u = typeof url === "string" ? url : url.toString();
        return (
          u.includes("/api/notes/abc-123/attachments") &&
          (init as RequestInit | undefined)?.method === "POST"
        );
      });
      expect(linkCall).toBeDefined();
    });
  });

  it("oversized file is rejected before any upload fires", async () => {
    installFetch({ "GET /api/notes": { body: baseNote } });
    const xhrs = installXhr();
    renderAt("/n/abc-123/edit");

    const cm = await screen.findByTestId("cm-editor");
    const dropZone = cm.closest("div.relative");

    const big = new File([new Uint8Array([1])], "huge.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 200 * 1024 * 1024 });

    const dataTransfer = {
      files: [big],
      items: [{ kind: "file" }],
      types: ["Files"],
    } as unknown as DataTransfer;
    fireEvent.drop(dropZone!, { dataTransfer });

    expect(xhrs.length).toBe(0);
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts.some((t) => /too large/i.test(t.message))).toBe(true);
    });
  });
});
