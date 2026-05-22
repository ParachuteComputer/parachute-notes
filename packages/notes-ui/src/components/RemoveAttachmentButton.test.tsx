import { RemoveAttachmentButton } from "@/components/RemoveAttachmentButton";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import type { NoteAttachment } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FetchEntry {
  status?: number;
  body?: unknown;
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
        json: async () => entry.body ?? null,
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

const attachment: NoteAttachment = {
  id: "att-1",
  filename: "screenshot.png",
  mimeType: "image/png",
  path: "2026-04-18/screenshot.png",
};

function Wrapper({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderButton() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return {
    qc,
    ...render(<RemoveAttachmentButton noteId="note-a" attachment={attachment} />, {
      wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper>,
    }),
  };
}

// The component arms the Remove button after a short delay to prevent double-click
// accidents. Real timers + small sleep is simpler than mocking time, especially
// because TanStack Query mutations schedule real microtasks that fake timers stall.
const waitForArm = () => new Promise<void>((r) => setTimeout(r, 300));

describe("RemoveAttachmentButton", () => {
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

  it("opens a confirm dialog before calling DELETE", async () => {
    const fetchImpl = installFetch({
      "DELETE /api/notes/note-a/attachments/att-1": { status: 204 },
    });
    const { qc } = renderButton();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    fireEvent.click(screen.getByRole("button", { name: /remove attachment screenshot\.png/i }));
    expect(await screen.findByText(/remove attachment\?/i)).toBeInTheDocument();

    const removeBtn = screen.getByRole("button", { name: /^remove$/i });
    expect(removeBtn).toBeDisabled();
    await waitForArm();
    expect(removeBtn).not.toBeDisabled();

    fireEvent.click(removeBtn);

    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith(
        "http://localhost:1940/api/notes/note-a/attachments/att-1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["note", "dev", "note-a"] }),
    );
    await waitFor(() =>
      expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/removed screenshot\.png/i),
    );
  });

  it("Cancel closes the dialog without calling DELETE", async () => {
    const fetchImpl = installFetch({
      "DELETE /api/notes/note-a/attachments/att-1": { status: 204 },
    });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /remove attachment screenshot\.png/i }));
    await waitForArm();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByText(/remove attachment\?/i)).not.toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats 404 as already-removed: toasts and closes", async () => {
    installFetch({
      "DELETE /api/notes/note-a/attachments/att-1": { status: 404 },
    });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /remove attachment screenshot\.png/i }));
    await waitForArm();
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    await waitFor(() =>
      expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(
        /already removed screenshot\.png/i,
      ),
    );
    expect(screen.queryByText(/remove attachment\?/i)).not.toBeInTheDocument();
  });

  it("surfaces 401 as a reconnect prompt without closing the dialog", async () => {
    installFetch({
      "DELETE /api/notes/note-a/attachments/att-1": { status: 401 },
    });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /remove attachment screenshot\.png/i }));
    await waitForArm();
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/session expired/i);
    expect(screen.getByText(/remove attachment\?/i)).toBeInTheDocument();
  });

  it("a second remove after the first lands returns 404 without crashing", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return {
          ok: calls === 1,
          status: calls === 1 ? 204 : 404,
          json: async () => null,
          text: async () => "",
        } as Response;
      }),
    );
    renderButton();

    const trigger = screen.getByRole("button", { name: /remove attachment screenshot\.png/i });
    fireEvent.click(trigger);
    await waitForArm();
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/^removed screenshot/i),
    );

    fireEvent.click(trigger);
    await waitForArm();
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/already removed/i),
    );
    expect(calls).toBe(2);
  });
});
