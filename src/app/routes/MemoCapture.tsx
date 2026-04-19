import {
  type PermissionError,
  type RecorderController,
  createRecorder,
  memoFilename,
  memoNoteContent,
  memoPath,
  pickMimeType,
  requestMic,
} from "@/lib/capture/recorder";
import { blobRef, enqueue, newBlobId, newLocalId } from "@/lib/sync";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault";
import { useSync } from "@/providers/SyncProvider";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";

type Phase =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "denied"; reason: string; message: string }
  | { kind: "recording"; startedAt: number }
  | { kind: "paused"; elapsedMs: number }
  | { kind: "review"; data: ArrayBuffer; mimeType: string; url: string; durationMs: number }
  | { kind: "saving" }
  | { kind: "error"; message: string };

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function MemoCapture() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const { db, blobStore, engine } = useSync();

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [elapsedMs, setElapsedMs] = useState(0);
  const recorderRef = useRef<RecorderController | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Tick the elapsed-time display while recording. Paused state holds the
  // displayed elapsed steady at the accumulated value.
  useEffect(() => {
    if (phase.kind !== "recording") return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - phase.startedAt);
    }, 250);
    return () => clearInterval(interval);
  }, [phase]);

  // Revoke any object URL we created for playback when the component unmounts
  // or we move past review.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const startRecording = useCallback(async () => {
    setPhase({ kind: "requesting" });
    try {
      const mimeType = pickMimeType();
      if (!mimeType) {
        setPhase({
          kind: "error",
          message: "This browser can't record audio in a format we can save.",
        });
        return;
      }
      const stream = await requestMic();
      const rec = createRecorder({ stream, mimeType });
      recorderRef.current = rec;
      rec.start();
      setElapsedMs(0);
      setPhase({ kind: "recording", startedAt: Date.now() });
    } catch (e) {
      const perm = e as PermissionError;
      if (perm.kind === "permission-denied") {
        setPhase({
          kind: "denied",
          reason: "permission-denied",
          message:
            "Microphone access was denied. Update your browser's site settings to record memos.",
        });
      } else if (perm.kind === "no-device") {
        setPhase({
          kind: "denied",
          reason: "no-device",
          message: "No microphone was found on this device.",
        });
      } else {
        setPhase({
          kind: "denied",
          reason: "unavailable",
          message:
            perm instanceof Error ? perm.message : "Microphone is not available in this browser.",
        });
      }
    }
  }, []);

  const pauseRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || phase.kind !== "recording") return;
    rec.pause();
    setPhase({ kind: "paused", elapsedMs });
  }, [phase, elapsedMs]);

  const resumeRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || phase.kind !== "paused") return;
    rec.resume();
    setPhase({ kind: "recording", startedAt: Date.now() - phase.elapsedMs });
  }, [phase]);

  const stopRecording = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (phase.kind !== "recording" && phase.kind !== "paused") return;
    try {
      const result = await rec.stop();
      recorderRef.current = null;
      const blob = new Blob([result.data], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = url;
      setPhase({
        kind: "review",
        data: result.data,
        mimeType: result.mimeType,
        url,
        durationMs: result.durationMs,
      });
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : "Recording failed.",
      });
    }
  }, [phase]);

  const discard = useCallback(() => {
    const rec = recorderRef.current;
    if (rec) {
      rec.cancel();
      recorderRef.current = null;
    }
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPhase({ kind: "idle" });
    setElapsedMs(0);
  }, []);

  const save = useCallback(async () => {
    if (phase.kind !== "review") return;
    if (!db || !blobStore || !activeVault) {
      pushToast("Sync queue not ready — try again in a moment.", "error");
      return;
    }
    setPhase({ kind: "saving" });
    const recordedAt = new Date();
    const filename = memoFilename(phase.mimeType, recordedAt);
    const path = memoPath(recordedAt);
    const content = memoNoteContent(filename, recordedAt);
    const localId = newLocalId();
    const blobId = newBlobId();
    try {
      await blobStore.put(blobId, phase.data, phase.mimeType, activeVault.id);
      await enqueue(
        db,
        {
          kind: "create-note",
          localId,
          payload: { content, path, tags: ["memo"] },
        },
        { vaultId: activeVault.id },
      );
      await enqueue(
        db,
        { kind: "upload-attachment", blobId, filename, mimeType: phase.mimeType },
        { vaultId: activeVault.id },
      );
      await enqueue(
        db,
        {
          kind: "link-attachment",
          noteId: localId,
          pathRef: blobRef(blobId),
          mimeType: phase.mimeType,
        },
        { vaultId: activeVault.id },
      );
      // Kick the engine so online users see it flush right away; offline it
      // no-ops and the next online event picks it up.
      void engine?.runOnce();
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      pushToast("Memo saved — syncing to your vault.", "success");
      navigate("/notes");
    } catch (e) {
      setPhase({
        kind: "review",
        data: phase.data,
        mimeType: phase.mimeType,
        url: phase.url,
        durationMs: phase.durationMs,
      });
      pushToast(e instanceof Error ? `Save failed: ${e.message}` : "Save failed.", "error");
    }
  }, [phase, db, blobStore, activeVault, engine, navigate, pushToast]);

  if (!activeVault) return <Navigate to="/" replace />;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <nav className="mb-4 text-sm text-fg-dim">
        <Link to="/notes" className="hover:text-accent">
          ← All notes
        </Link>
      </nav>

      <header className="mb-8">
        <h1 className="font-serif text-2xl text-fg">Voice memo</h1>
        <p className="mt-1 text-sm text-fg-dim">
          Capture a thought. Saves as a note in your vault with the audio attached.
        </p>
      </header>

      <section className="flex flex-col items-center gap-6 rounded-xl border border-border bg-card p-10">
        {phase.kind === "idle" ? (
          <>
            <RecordButton onClick={startRecording} label="Start recording" />
            <p className="text-xs text-fg-dim">Tap to request microphone access.</p>
          </>
        ) : null}

        {phase.kind === "requesting" ? (
          <p className="text-sm text-fg-muted">Requesting microphone…</p>
        ) : null}

        {phase.kind === "denied" ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-red-400">{phase.message}</p>
            <button
              type="button"
              onClick={startRecording}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Try again
            </button>
          </div>
        ) : null}

        {phase.kind === "recording" || phase.kind === "paused" ? (
          <>
            <div className="flex flex-col items-center gap-2">
              <ElapsedBadge
                ms={phase.kind === "paused" ? phase.elapsedMs : elapsedMs}
                recording={phase.kind === "recording"}
              />
            </div>
            <div className="flex gap-3">
              {phase.kind === "recording" ? (
                <button
                  type="button"
                  onClick={pauseRecording}
                  className="rounded-md border border-border bg-bg px-4 py-2 text-sm text-fg-muted hover:text-accent"
                >
                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  onClick={resumeRecording}
                  className="rounded-md border border-border bg-bg px-4 py-2 text-sm text-fg-muted hover:text-accent"
                >
                  Resume
                </button>
              )}
              <button
                type="button"
                onClick={stopRecording}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
              >
                Stop
              </button>
              <button
                type="button"
                onClick={discard}
                className="rounded-md border border-border bg-bg px-4 py-2 text-sm text-fg-dim hover:text-red-400"
              >
                Cancel
              </button>
            </div>
          </>
        ) : null}

        {phase.kind === "review" ? (
          <div className="flex w-full flex-col items-center gap-4">
            <p className="text-sm text-fg-muted">
              Recorded {formatElapsed(phase.durationMs)} of audio.
            </p>
            <audio controls src={phase.url} className="w-full">
              <track kind="captions" />
            </audio>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={discard}
                className="rounded-md border border-border bg-bg px-4 py-2 text-sm text-fg-muted hover:text-red-400"
              >
                Discard &amp; re-record
              </button>
              <button
                type="button"
                onClick={save}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
              >
                Save memo
              </button>
            </div>
          </div>
        ) : null}

        {phase.kind === "saving" ? <p className="text-sm text-fg-muted">Saving…</p> : null}

        {phase.kind === "error" ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-red-400">{phase.message}</p>
            <button
              type="button"
              onClick={() => setPhase({ kind: "idle" })}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Start over
            </button>
          </div>
        ) : null}
      </section>

      <aside className="mt-6 rounded-md border border-border bg-card/60 p-4 text-xs text-fg-dim">
        <p className="mb-1 font-medium text-fg-muted">Tips</p>
        <ul className="list-inside list-disc space-y-0.5">
          <li>Recording stops if you leave the tab or lock your screen.</li>
          <li>Audio is saved in your vault; no transcription yet (coming next).</li>
          <li>If you're offline, memos queue up and sync when you're back.</li>
        </ul>
      </aside>
    </div>
  );
}

function RecordButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-full border border-accent/30 bg-accent/10 text-accent transition hover:bg-accent/15 focus:outline-none focus:ring-2 focus:ring-accent"
    >
      <MicIcon />
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

function ElapsedBadge({ ms, recording }: { ms: number; recording: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className={`inline-block h-3 w-3 rounded-full ${
          recording ? "animate-pulse bg-red-500" : "bg-fg-dim"
        }`}
      />
      <span aria-live="polite" className="font-mono text-2xl tabular-nums text-fg">
        {formatElapsed(ms)}
      </span>
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Microphone"
    >
      <title>Microphone</title>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}
