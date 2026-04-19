import { Settings } from "@/app/routes/Settings";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub scribe client so the connection-test button hits our fake instead of
// making a real network call.
const scribeFake = {
  health: vi.fn<() => Promise<boolean>>(async () => true),
};

vi.mock("@/lib/scribe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/scribe")>("@/lib/scribe");
  return {
    ...actual,
    scribeHealth: () => scribeFake.health(),
  };
});

function seedActiveVault() {
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

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={["/settings"]}>
      <Routes>
        <Route path="/settings" element={<Settings />} />
        <Route path="/" element={<div>HomePage</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Settings route", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    scribeFake.health = vi.fn(async () => true);
    seedActiveVault();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects to / when no active vault", () => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    renderSettings();
    expect(screen.getByText("HomePage")).toBeInTheDocument();
  });

  it("renders the scribe section for the active vault", () => {
    renderSettings();
    expect(screen.getByRole("heading", { name: /transcription/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/localhost:3200/)).toBeInTheDocument();
  });

  it("saves scribe settings to localStorage on Save", async () => {
    renderSettings();
    const urlInput = screen.getByPlaceholderText(/localhost:3200/) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(urlInput, { target: { value: "http://scribe.dev" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    });
    const stored = JSON.parse(localStorage.getItem("lens:scribe:dev") ?? "{}");
    expect(stored.url).toBe("http://scribe.dev");
    expect(useToastStore.getState().toasts[0]?.message).toContain("Scribe settings saved");
  });

  it("shows success when test-connection succeeds", async () => {
    scribeFake.health = vi.fn(async () => true);
    renderSettings();
    const urlInput = screen.getByPlaceholderText(/localhost:3200/) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(urlInput, { target: { value: "http://scribe.dev" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    });
    await waitFor(() => {
      expect(screen.getByText(/scribe is reachable/i)).toBeInTheDocument();
    });
  });

  it("shows failure when test-connection fails", async () => {
    scribeFake.health = vi.fn(async () => false);
    renderSettings();
    const urlInput = screen.getByPlaceholderText(/localhost:3200/) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(urlInput, { target: { value: "http://scribe.dev" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    });
    await waitFor(() => {
      expect(screen.getByText(/couldn't reach scribe/i)).toBeInTheDocument();
    });
  });

  it("pre-fills from stored settings and clears on Clear", async () => {
    localStorage.setItem(
      "lens:scribe:dev",
      JSON.stringify({ url: "http://scribe.dev", cleanup: true }),
    );
    renderSettings();
    const urlInput = screen.getByPlaceholderText(/localhost:3200/) as HTMLInputElement;
    expect(urlInput.value).toBe("http://scribe.dev");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
    });
    expect(localStorage.getItem("lens:scribe:dev")).toBeNull();
  });
});
