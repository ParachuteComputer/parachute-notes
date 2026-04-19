import { useQueueStatus } from "@/lib/sync";
import { useVaultStore } from "@/lib/vault";
import { useSync } from "@/providers/SyncProvider";

// Single-purpose chip for voice-memo notes. A transcribe-memo row sits in the
// queue from capture-time until either the server returns a transcript or the
// engine gives up after 24h. The "unavailable" marker is a string the
// transcribe step writes into the note body when it exhausts retries — we
// detect it by content match because by that point the queue row is gone.

const UNAVAILABLE_MARKER = "_Transcription unavailable._";

export function TranscriptionStatus({
  noteId,
  content,
}: {
  noteId: string;
  content: string;
}) {
  const { db } = useSync();
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const status = useQueueStatus(db, activeVaultId);

  const pending = status.rows.some(
    (r) => r.mutation.kind === "transcribe-memo" && r.mutation.noteId === noteId,
  );
  const unavailable = !pending && content.includes(UNAVAILABLE_MARKER);

  if (pending) {
    return (
      <output
        aria-live="polite"
        className="mb-4 inline-flex items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-1.5 text-xs text-sky-300"
      >
        <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-400" />
        Transcribing…
      </output>
    );
  }

  if (unavailable) {
    return (
      <output className="mb-4 inline-flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-200">
        Transcription unavailable — open the audio below and add a note by hand.
      </output>
    );
  }

  return null;
}
