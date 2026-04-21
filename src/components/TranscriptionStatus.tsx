// Single-purpose chip for voice-memo notes. Vault's transcription-worker
// seeds the note with `_Transcript pending._` and swaps it for either the
// transcript or `_Transcription unavailable._` when it finishes. We mirror
// that state into the editor so the user isn't staring at a placeholder
// wondering whether anything is happening.

const PENDING_MARKER = "_Transcript pending._";
const UNAVAILABLE_MARKER = "_Transcription unavailable._";

export function TranscriptionStatus({
  content,
}: {
  content: string;
}) {
  const pending = content.includes(PENDING_MARKER);
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
