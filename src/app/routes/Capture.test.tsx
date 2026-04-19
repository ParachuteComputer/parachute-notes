import { Capture } from "@/app/routes/Capture";
import { useVaultStore } from "@/lib/vault/store";
import { SyncProvider } from "@/providers/SyncProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <SyncProvider>{children}</SyncProvider>
    </QueryClientProvider>
  );
}

function renderCapture() {
  return render(
    <MemoryRouter initialEntries={["/capture"]}>
      <Routes>
        <Route path="/capture" element={<Capture />} />
        <Route path="/" element={<div>HomePage</div>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: Wrapper },
  );
}

describe("Capture container", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    seedStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects to / when no active vault", () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    renderCapture();
    expect(screen.getByText("HomePage")).toBeInTheDocument();
  });

  it("defaults to the Text tab", async () => {
    renderCapture();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Text" })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByLabelText(/quick note content/i)).toBeInTheDocument();
    // Voice UI shouldn't be present when Text is active.
    expect(screen.queryByRole("button", { name: /start recording/i })).not.toBeInTheDocument();
  });

  it("switches to Voice when the Voice tab is clicked and persists the choice", async () => {
    renderCapture();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Voice" })).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Voice" }));
    });
    expect(screen.getByRole("tab", { name: "Voice" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /start recording/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/quick note content/i)).not.toBeInTheDocument();
    expect(localStorage.getItem("lens:capture:mode")).toBe("voice");
  });

  it("remembers the last-used tab across renders", async () => {
    localStorage.setItem("lens:capture:mode", "voice");
    renderCapture();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start recording/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: "Voice" })).toHaveAttribute("aria-selected", "true");
  });
});
