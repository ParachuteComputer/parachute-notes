import { Settings } from "@/app/routes/Settings";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="/settings" element={<Settings />} />
          <Route path="/" element={<div>HomePage</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Settings route", () => {
  beforeEach(() => {
    localStorage.clear();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
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

  it("does not render a scribe section — transcription is vault-level", () => {
    renderSettings();
    expect(screen.queryByRole("heading", { name: /transcription/i })).not.toBeInTheDocument();
  });

  it("renders tag roles with defaults and saves overrides into the vault-settings cache", async () => {
    renderSettings();
    const section = screen
      .getByRole("heading", { name: /tag roles/i })
      .closest("section") as HTMLElement;
    const pinnedInput = within(section).getByLabelText(/pinned tag role/i);
    expect((pinnedInput as HTMLInputElement).value).toBe("pinned");

    await act(async () => {
      fireEvent.change(pinnedInput, { target: { value: "starred" } });
    });
    await act(async () => {
      fireEvent.click(within(section).getByRole("button", { name: /^save$/i }));
    });
    // Tag roles now live in the vault settings note; localStorage is the
    // write-through cache under the new `lens:settings:<vaultId>` key. No
    // active client is mounted in the test, so update() takes the offline
    // path and leaves the change pinned in the cache as a dirtyPatch.
    const stored = JSON.parse(localStorage.getItem("lens:settings:dev") ?? "{}") as {
      settings?: { tagRoles?: { pinned?: string; archived?: string } };
      dirtyPatch?: { tagRoles?: { pinned?: string } } | null;
    };
    expect(stored.settings?.tagRoles?.pinned).toBe("starred");
    expect(stored.settings?.tagRoles?.archived).toBe("archived");
    expect(stored.dirtyPatch?.tagRoles?.pinned).toBe("starred");
  });

  it("renders the path-tree section and persists mode changes", async () => {
    renderSettings();
    const section = screen
      .getByRole("heading", { name: /folder tree/i })
      .closest("section") as HTMLElement;
    const auto = within(section).getByLabelText(/^auto/i) as HTMLInputElement;
    expect(auto.checked).toBe(true);

    const always = within(section).getByLabelText(/^always/i);
    await act(async () => {
      fireEvent.click(always);
    });
    const stored = JSON.parse(localStorage.getItem("lens:path-tree:dev") ?? "{}") as {
      mode?: string;
    };
    expect(stored.mode).toBe("always");
  });

  it("reset-to-defaults writes the defaults back through the cache", async () => {
    // Seed the settings cache directly — simulates a prior non-default
    // selection that rehydrates into the UI on mount.
    localStorage.setItem(
      "lens:settings:dev",
      JSON.stringify({
        settings: {
          schemaVersion: 1,
          tagRoles: {
            pinned: "starred",
            archived: "done",
            captureVoice: "memo",
            captureText: "inbox",
            view: "preset",
          },
        },
        serverSettings: null,
        serverUpdatedAt: null,
        noteExists: false,
        dirtyPatch: {
          tagRoles: {
            pinned: "starred",
            archived: "done",
            captureVoice: "memo",
            captureText: "inbox",
            view: "preset",
          },
        },
      }),
    );
    renderSettings();
    const section = screen
      .getByRole("heading", { name: /tag roles/i })
      .closest("section") as HTMLElement;
    expect((within(section).getByLabelText(/pinned tag role/i) as HTMLInputElement).value).toBe(
      "starred",
    );
    await act(async () => {
      fireEvent.click(within(section).getByRole("button", { name: /reset to defaults/i }));
    });
    const stored = JSON.parse(localStorage.getItem("lens:settings:dev") ?? "{}") as {
      settings?: { tagRoles?: { pinned?: string } };
    };
    expect(stored.settings?.tagRoles?.pinned).toBe("pinned");
    expect((within(section).getByLabelText(/pinned tag role/i) as HTMLInputElement).value).toBe(
      "pinned",
    );
  });
});
