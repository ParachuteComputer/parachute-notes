import { SyncStatusPanel } from "@/components/SyncStatusPanel";
import type { PendingRow, QueueStatus, QuotaReport } from "@/lib/sync";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks -----------------------------------------------------------------

const mockStatus = vi.fn<() => QueueStatus>(() => ({
  rows: [],
  byKind: {},
  total: 0,
  pendingCount: 0,
  needsHumanCount: 0,
  authHalt: null,
}));
const mockSync = vi.fn(() => ({
  db: {} as unknown as ReturnType<typeof Object>,
  blobStore: null,
  engine: null,
  isOnline: true,
  isDraining: false,
  lastSyncedAt: null as number | null,
}));
const retryRowMock = vi.fn(async (_db: unknown, _seq: number) => {});
const discardRowMock = vi.fn(async (_db: unknown, _seq: number) => {});
const clearMock = vi.fn(async (_db: unknown, _vaultId: string) => 0);
const estimateMock = vi.fn<() => Promise<QuotaReport>>(async () => ({
  supported: false,
  persisted: false,
  usage: null,
  quota: null,
}));

vi.mock("@/providers/SyncProvider", () => ({
  useSync: () => mockSync(),
}));
vi.mock("@/lib/sync", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sync")>("@/lib/sync");
  return {
    ...actual,
    useQueueStatus: () => mockStatus(),
    retryRow: (...args: Parameters<typeof retryRowMock>) => retryRowMock(...args),
    discardRow: (...args: Parameters<typeof discardRowMock>) => discardRowMock(...args),
    clearPendingForVault: (...args: Parameters<typeof clearMock>) => clearMock(...args),
    estimate: () => estimateMock(),
  };
});

// --- Helpers ---------------------------------------------------------------

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

function renderPanel() {
  return render(
    <MemoryRouter>
      <SyncStatusPanel />
    </MemoryRouter>,
  );
}

function needsHumanRow(seq: number, targetId: string): PendingRow {
  return {
    seq,
    id: `row-${seq}`,
    vaultId: "v",
    mutation: { kind: "delete-note", targetId },
    createdAt: Date.now(),
    attemptCount: 3,
    nextAttemptAt: 0,
    lastError: "conflict",
    status: "needs-human",
  };
}

// --- Tests -----------------------------------------------------------------

describe("SyncStatusPanel headline", () => {
  beforeEach(() => {
    seedVault();
    useToastStore.setState({ toasts: [] });
    retryRowMock.mockReset();
    discardRowMock.mockReset();
    clearMock.mockReset();
    estimateMock.mockReset();
    estimateMock.mockResolvedValue({ supported: false, persisted: false, usage: null, quota: null });
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
      db: {},
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

  it("renders 'All caught up' when online, not draining, queue empty", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: /all caught up/i })).toBeInTheDocument();
  });

  it("renders 'Offline — changes queued' when offline", () => {
    mockSync.mockReturnValue({
      db: {},
      blobStore: null,
      engine: null,
      isOnline: false,
      isDraining: false,
      lastSyncedAt: null,
    });
    renderPanel();
    expect(screen.getByRole("heading", { name: /offline/i })).toBeInTheDocument();
  });

  it("renders a Reconnect link when authHalt is present", () => {
    mockStatus.mockReturnValue({
      rows: [],
      byKind: {},
      total: 0,
      pendingCount: 0,
      needsHumanCount: 0,
      authHalt: { vaultId: "v", at: 1, message: "session expired" },
    });
    renderPanel();
    expect(screen.getByRole("heading", { name: /reconnect needed/i })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /reconnect to resume sync/i });
    expect(link).toHaveAttribute("href", "/add");
  });

  it("renders the 'Sync pending' headline with queue breakdown when rows exist", () => {
    mockStatus.mockReturnValue({
      rows: [],
      byKind: { "create-note": 2, "delete-note": 1 },
      total: 3,
      pendingCount: 3,
      needsHumanCount: 0,
      authHalt: null,
    });
    renderPanel();
    expect(screen.getByRole("heading", { name: /sync pending/i })).toBeInTheDocument();
    expect(screen.getByText(/new notes/i)).toBeInTheDocument();
    expect(screen.getByText(/deletions/i)).toBeInTheDocument();
  });
});

describe("SyncStatusPanel needs-human actions", () => {
  beforeEach(() => {
    seedVault();
    useToastStore.setState({ toasts: [] });
    retryRowMock.mockReset();
    discardRowMock.mockReset();
    mockStatus.mockReset();
    mockSync.mockReturnValue({
      db: {},
      blobStore: null,
      engine: null,
      isOnline: true,
      isDraining: false,
      lastSyncedAt: null,
    });
    estimateMock.mockResolvedValue({ supported: false, persisted: false, usage: null, quota: null });
  });
  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    vi.restoreAllMocks();
  });

  it("Retry calls retryRow with the row's seq and toasts", async () => {
    const row = needsHumanRow(7, "target-1");
    mockStatus.mockReturnValue({
      rows: [row],
      byKind: { "delete-note": 1 },
      total: 1,
      pendingCount: 0,
      needsHumanCount: 1,
      authHalt: null,
    });

    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    });

    expect(retryRowMock).toHaveBeenCalledWith({}, 7);
    expect(useToastStore.getState().toasts.some((t) => /retrying/i.test(t.message))).toBe(true);
  });

  it("Discard confirms then calls discardRow", async () => {
    const row = needsHumanRow(9, "target-2");
    mockStatus.mockReturnValue({
      rows: [row],
      byKind: { "delete-note": 1 },
      total: 1,
      pendingCount: 0,
      needsHumanCount: 1,
      authHalt: null,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    });

    expect(discardRowMock).toHaveBeenCalledWith({}, 9);
  });

  it("Discard does nothing when the user cancels the confirm", async () => {
    const row = needsHumanRow(11, "target-3");
    mockStatus.mockReturnValue({
      rows: [row],
      byKind: { "delete-note": 1 },
      total: 1,
      pendingCount: 0,
      needsHumanCount: 1,
      authHalt: null,
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);

    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    });

    expect(discardRowMock).not.toHaveBeenCalled();
  });
});

describe("SyncStatusPanel Clear-all", () => {
  beforeEach(() => {
    seedVault();
    useToastStore.setState({ toasts: [] });
    clearMock.mockReset();
    estimateMock.mockResolvedValue({ supported: false, persisted: false, usage: null, quota: null });
    mockSync.mockReturnValue({
      db: {},
      blobStore: null,
      engine: null,
      isOnline: true,
      isDraining: false,
      lastSyncedAt: null,
    });
  });
  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    vi.restoreAllMocks();
  });

  it("wipes all pending and toasts the count", async () => {
    mockStatus.mockReturnValue({
      rows: [],
      byKind: { "delete-note": 2 },
      total: 2,
      pendingCount: 2,
      needsHumanCount: 0,
      authHalt: null,
    });
    clearMock.mockResolvedValue(2);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /clear all pending/i }));
    });

    expect(clearMock).toHaveBeenCalledWith({}, "v");
    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => /cleared 2/i.test(t.message))).toBe(true);
    });
  });
});

describe("SyncStatusPanel storage bar", () => {
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
      db: {},
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

  it("does not show a warning below the 80% threshold", async () => {
    // 40% full
    estimateMock.mockResolvedValue({
      supported: true,
      persisted: true,
      usage: 400,
      quota: 1000,
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/storage/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/nearly full/i)).not.toBeInTheDocument();
  });

  it("shows a warning at or above the 80% threshold", async () => {
    estimateMock.mockResolvedValue({
      supported: true,
      persisted: true,
      usage: 900,
      quota: 1000,
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/nearly full/i)).toBeInTheDocument();
    });
  });
});
