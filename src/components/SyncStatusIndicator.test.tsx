import { SyncStatusIndicator } from "@/components/SyncStatusIndicator";
import type { QueueStatus } from "@/lib/sync";
import { useVaultStore } from "@/lib/vault";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockStatus = vi.fn<() => QueueStatus>(() => ({
  rows: [],
  byKind: {},
  total: 0,
  pendingCount: 0,
  needsHumanCount: 0,
  authHalt: null,
}));
const mockSync = vi.fn<
  () => {
    db: null;
    blobStore: null;
    engine: null;
    isOnline: boolean;
    isDraining: boolean;
    lastSyncedAt: number | null;
  }
>(() => ({
  db: null,
  blobStore: null,
  engine: null,
  isOnline: true,
  isDraining: false,
  lastSyncedAt: null,
}));

vi.mock("@/providers/SyncProvider", () => ({
  useSync: () => mockSync(),
}));
vi.mock("@/lib/sync", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sync")>("@/lib/sync");
  return {
    ...actual,
    useQueueStatus: () => mockStatus(),
  };
});

function seedVault() {
  useVaultStore.setState({
    vaults: {
      v: {
        id: "v",
        url: "http://localhost:1940",
        name: "dev",
        issuer: "http://localhost:1940",
        clientId: "c",
        scope: "full",
        addedAt: "2026-04-18T00:00:00.000Z",
        lastUsedAt: "2026-04-18T00:00:00.000Z",
      },
    },
    activeVaultId: "v",
  });
}

function renderIndicator() {
  return render(
    <MemoryRouter>
      <SyncStatusIndicator />
    </MemoryRouter>,
  );
}

describe("SyncStatusIndicator tone", () => {
  beforeEach(() => {
    seedVault();
    mockStatus.mockReset();
    mockSync.mockReset();
    mockStatus.mockReturnValue({
      rows: [],
      byKind: {},
      total: 0,
      pendingCount: 0,
      needsHumanCount: 0,
      authHalt: null,
    });
    mockSync.mockReturnValue({
      db: null,
      blobStore: null,
      engine: null,
      isOnline: true,
      isDraining: false,
      lastSyncedAt: null,
    });
  });
  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it("reads 'Online' when connected, not draining, no halt", () => {
    renderIndicator();
    expect(screen.getByRole("button", { name: /sync status: online/i })).toBeInTheDocument();
  });

  it("reads 'Offline' when navigator is offline", () => {
    mockSync.mockReturnValue({
      db: null,
      blobStore: null,
      engine: null,
      isOnline: false,
      isDraining: false,
      lastSyncedAt: null,
    });
    renderIndicator();
    expect(screen.getByRole("button", { name: /sync status: offline/i })).toBeInTheDocument();
  });

  it("reads 'Syncing…' while draining", () => {
    mockSync.mockReturnValue({
      db: null,
      blobStore: null,
      engine: null,
      isOnline: true,
      isDraining: true,
      lastSyncedAt: null,
    });
    renderIndicator();
    expect(screen.getByRole("button", { name: /sync status: syncing/i })).toBeInTheDocument();
  });

  it("reads 'Reconnect' when auth-halt is set (highest priority)", () => {
    mockStatus.mockReturnValue({
      rows: [],
      byKind: {},
      total: 0,
      pendingCount: 0,
      needsHumanCount: 0,
      authHalt: { vaultId: "v", at: 1, message: "expired" },
    });
    mockSync.mockReturnValue({
      db: null,
      blobStore: null,
      engine: null,
      isOnline: false,
      isDraining: true,
      lastSyncedAt: null,
    });
    renderIndicator();
    expect(screen.getByRole("button", { name: /sync status: reconnect/i })).toBeInTheDocument();
  });
});

describe("SyncStatusIndicator pending badge", () => {
  beforeEach(() => {
    seedVault();
    mockSync.mockReturnValue({
      db: null,
      blobStore: null,
      engine: null,
      isOnline: true,
      isDraining: false,
      lastSyncedAt: null,
    });
  });
  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it("hides the badge when total = 0", () => {
    mockStatus.mockReturnValue({
      rows: [],
      byKind: {},
      total: 0,
      pendingCount: 0,
      needsHumanCount: 0,
      authHalt: null,
    });
    renderIndicator();
    expect(screen.queryByLabelText(/pending/i)).not.toBeInTheDocument();
  });

  it("shows the pending count when > 0", () => {
    mockStatus.mockReturnValue({
      rows: [],
      byKind: { "delete-note": 3 },
      total: 3,
      pendingCount: 3,
      needsHumanCount: 0,
      authHalt: null,
    });
    renderIndicator();
    expect(screen.getByLabelText("3 pending")).toHaveTextContent("3");
  });
});

describe("SyncStatusIndicator open/close", () => {
  beforeEach(() => {
    seedVault();
    mockStatus.mockReturnValue({
      rows: [],
      byKind: {},
      total: 0,
      pendingCount: 0,
      needsHumanCount: 0,
      authHalt: null,
    });
    mockSync.mockReturnValue({
      db: null,
      blobStore: null,
      engine: null,
      isOnline: true,
      isDraining: false,
      lastSyncedAt: null,
    });
  });
  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it("clicking the button opens the panel", () => {
    renderIndicator();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /sync status/i }));
    expect(screen.getByRole("dialog", { name: /sync status details/i })).toBeInTheDocument();
  });

  it("clicking outside closes the panel", () => {
    render(
      <MemoryRouter>
        <div>
          <button type="button">outside</button>
          <SyncStatusIndicator />
        </div>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /sync status/i }));
    expect(screen.getByRole("dialog", { name: /sync status details/i })).toBeInTheDocument();
    act(() => {
      fireEvent.mouseDown(screen.getByRole("button", { name: "outside" }));
    });
    expect(screen.queryByRole("dialog", { name: /sync status details/i })).not.toBeInTheDocument();
  });
});
