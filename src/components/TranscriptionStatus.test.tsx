import { TranscriptionStatus } from "@/components/TranscriptionStatus";
import type { PendingRow, QueueStatus } from "@/lib/sync";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockStatus = vi.fn<() => QueueStatus>(() => ({
  rows: [],
  byKind: {},
  total: 0,
  pendingCount: 0,
  needsHumanCount: 0,
  authHalt: null,
}));
vi.mock("@/providers/SyncProvider", () => ({
  useSync: () => ({
    db: {},
    blobStore: null,
    engine: null,
    isOnline: true,
    isDraining: false,
    lastSyncedAt: null,
  }),
}));
vi.mock("@/lib/vault", async () => {
  const actual = await vi.importActual<typeof import("@/lib/vault")>("@/lib/vault");
  return {
    ...actual,
    useVaultStore: Object.assign(
      (selector: (s: unknown) => unknown) => selector({ activeVaultId: "v" }),
      {
        setState: () => {},
      },
    ),
  };
});
vi.mock("@/lib/sync", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sync")>("@/lib/sync");
  return {
    ...actual,
    useQueueStatus: () => mockStatus(),
  };
});

function transcribeRow(noteId: string): PendingRow {
  return {
    seq: 1,
    id: "row-1",
    vaultId: "v",
    mutation: {
      kind: "transcribe-memo",
      noteId,
      blobId: "blob-1",
      filename: "memo.wav",
      mimeType: "audio/wav",
      marker: "_Transcript pending._",
    },
    createdAt: Date.now(),
    attemptCount: 0,
    nextAttemptAt: 0,
    status: "pending",
  };
}

describe("TranscriptionStatus", () => {
  beforeEach(() => {
    mockStatus.mockReset();
    mockStatus.mockReturnValue({
      rows: [],
      byKind: {},
      total: 0,
      pendingCount: 0,
      needsHumanCount: 0,
      authHalt: null,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders nothing when no transcribe row and no unavailable marker", () => {
    const { container } = render(<TranscriptionStatus noteId="n1" content="plain note body" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows 'Transcribing…' while a transcribe-memo row is queued for this note", () => {
    mockStatus.mockReturnValue({
      rows: [transcribeRow("n1")],
      byKind: { "transcribe-memo": 1 },
      total: 1,
      pendingCount: 1,
      needsHumanCount: 0,
      authHalt: null,
    });
    render(<TranscriptionStatus noteId="n1" content="_Transcript pending._" />);
    expect(screen.getByText(/transcribing/i)).toBeInTheDocument();
  });

  it("ignores transcribe rows that belong to a different note", () => {
    mockStatus.mockReturnValue({
      rows: [transcribeRow("other")],
      byKind: { "transcribe-memo": 1 },
      total: 1,
      pendingCount: 1,
      needsHumanCount: 0,
      authHalt: null,
    });
    const { container } = render(<TranscriptionStatus noteId="n1" content="body without marker" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows unavailable chip when content carries the marker and no row is queued", () => {
    render(
      <TranscriptionStatus
        noteId="n1"
        content="Some preamble.\n\n_Transcription unavailable._\n\nrest"
      />,
    );
    expect(screen.getByText(/transcription unavailable/i)).toBeInTheDocument();
  });
});
