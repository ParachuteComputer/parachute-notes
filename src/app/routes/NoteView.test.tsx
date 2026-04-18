import { NoteView } from "@/app/routes/NoteView";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FetchMap {
  [urlMatcher: string]: { status?: number; body: unknown };
}

function installFetch(map: FetchMap) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const matcher of Object.keys(map)) {
      if (url.includes(matcher)) {
        const entry = map[matcher];
        return {
          ok: (entry.status ?? 200) < 400,
          status: entry.status ?? 200,
          json: async () => entry.body,
          text: async () => "",
          blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
        } as Response;
      }
    }
    return {
      ok: false,
      status: 404,
      json: async () => null,
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
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/notes/:id" element={<NoteView />} />
        <Route path="/notes" element={<div>NotesListPage</div>} />
        <Route path="/add" element={<div>AddVaultPage</div>} />
        <Route path="*" element={<div>Other</div>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: Wrapper },
  );
}

describe("NoteView route", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders markdown content, metadata, tags, and back link", async () => {
    installFetch({
      "/api/notes": {
        body: {
          id: "abc-123",
          path: "Canon/Aaron",
          createdAt: "2026-04-16T04:30:54.177Z",
          updatedAt: "2026-04-17T00:05:07.721Z",
          content: "# Aaron Gabriel\n\nTeacher and builder.",
          metadata: { summary: "Canon note on Aaron." },
          tags: ["canon"],
          links: [],
          attachments: [],
        },
      },
    });

    renderAt("/notes/abc-123");

    expect(await screen.findByText("Aaron Gabriel")).toBeInTheDocument();
    expect(screen.getByText("Teacher and builder.")).toBeInTheDocument();
    expect(screen.getByText("Canon note on Aaron.")).toBeInTheDocument();
    // Tag chip links to the filtered list
    const tagChip = screen.getByRole("link", { name: "canon" });
    expect(tagChip).toHaveAttribute("href", "/notes?tag=canon");
    // Back link to /notes is present
    expect(screen.getByRole("link", { name: /all notes/i })).toBeInTheDocument();
    // Edit placeholder routes to the edit route (PR #5)
    expect(screen.getByRole("link", { name: /edit/i })).toHaveAttribute(
      "href",
      "/notes/abc-123/edit",
    );
  });

  it("resolves [[wikilinks]] via the outbound links table and renders as a /notes/<id> link", async () => {
    installFetch({
      "/api/notes": {
        body: {
          id: "me",
          path: "Canon/Aaron",
          createdAt: "2026-04-16T00:00:00Z",
          content: "See [[Canon/Uni]] for more. Also [[Missing/Note]].",
          tags: [],
          links: [
            {
              sourceId: "me",
              targetId: "uni-id",
              relationship: "wikilink",
              targetNote: { id: "uni-id", path: "Canon/Uni" },
            },
          ],
          attachments: [],
        },
      },
    });

    const { container } = renderAt("/notes/me");

    // Prefer the in-body wikilink (not the sidebar) via container scoping.
    await screen.findByText(/See/);
    const body = container.querySelector(".prose-note");
    expect(body).not.toBeNull();
    const resolvedLinks = Array.from(
      body!.querySelectorAll<HTMLAnchorElement>("a.wikilink-resolved"),
    );
    expect(resolvedLinks).toHaveLength(1);
    expect(resolvedLinks[0]).toHaveAttribute("href", "/notes/uni-id");
    expect(resolvedLinks[0]?.textContent).toBe("Canon/Uni");

    const unresolvedLinks = Array.from(
      body!.querySelectorAll<HTMLAnchorElement>("a.wikilink-unresolved"),
    );
    expect(unresolvedLinks).toHaveLength(1);
    expect(unresolvedLinks[0]).toHaveAttribute("href", "/notes/Missing%2FNote");
    expect(unresolvedLinks[0]?.textContent).toBe("Missing/Note");
  });

  it("renders inbound and outbound link panels with peer paths", async () => {
    installFetch({
      "/api/notes": {
        body: {
          id: "center",
          path: "hub",
          createdAt: "2026-04-16T00:00:00Z",
          content: "Hub.",
          tags: [],
          links: [
            {
              sourceId: "center",
              targetId: "out-1",
              relationship: "wikilink",
              targetNote: { id: "out-1", path: "Outbound/One" },
            },
            {
              sourceId: "in-1",
              targetId: "center",
              relationship: "wikilink",
              sourceNote: { id: "in-1", path: "Inbound/One" },
            },
          ],
          attachments: [],
        },
      },
    });

    renderAt("/notes/center");

    expect(await screen.findByRole("heading", { name: /Outbound \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Inbound \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Outbound\/One/ })).toHaveAttribute(
      "href",
      "/notes/out-1",
    );
    expect(screen.getByRole("link", { name: /Inbound\/One/ })).toHaveAttribute(
      "href",
      "/notes/in-1",
    );
  });

  it("renders an inline image attachment (blob-fetched through VaultClient)", async () => {
    installFetch({
      "/api/notes": {
        body: {
          id: "with-img",
          path: "media",
          createdAt: "2026-04-16T00:00:00Z",
          content: "pic",
          tags: [],
          links: [],
          attachments: [
            {
              id: "att-1",
              filename: "hero.png",
              mimeType: "image/png",
              url: "/attachments/att-1",
              size: 2048,
            },
          ],
        },
      },
      "/attachments/att-1": { body: null },
    });
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:fake-url");
    URL.revokeObjectURL = vi.fn();

    renderAt("/notes/with-img");

    const img = (await screen.findByAltText("hero.png")) as HTMLImageElement;
    await waitFor(() => {
      expect(img.src).toContain("blob:fake-url");
    });
    URL.createObjectURL = origCreate;
  });

  it("shows a 404 block when the vault returns no note for the id", async () => {
    installFetch({
      "/api/notes": { body: [] },
    });
    renderAt("/notes/nonexistent");
    expect(await screen.findByText(/note not found/i)).toBeInTheDocument();
  });

  it("routes through Reconnect on 401", async () => {
    installFetch({
      "/api/notes": { status: 401, body: null },
    });
    renderAt("/notes/any");
    expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /reconnect/i })).toHaveAttribute("href", "/add");
  });
});
