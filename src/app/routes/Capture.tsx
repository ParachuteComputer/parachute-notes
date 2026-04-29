import { TagEditor, normalizeTag } from "@/components/TagEditor";
import {
  type PermissionError,
  type RecorderController,
  createRecorder,
  memoFilename,
  memoPath,
  pickMimeType,
  requestMic,
} from "@/lib/capture/recorder";
import { blobRef, enqueue, newBlobId, newLocalId } from "@/lib/sync";
import { useToastStore } from "@/lib/toast/store";
import { useTagRoles, useVaultStore } from "@/lib/vault";
import { useSync } from "@/providers/SyncProvider";
import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router";

// Unified single-screen capture. The user can type, hold-to-record, or do
// both — submit writes one note tagged for whichever inputs were used.
// Replaces the prior tabbed text-vs-voice flow because "pick a mode first"
// adds friction the issue (#89) explicitly asked us to remove.
//
// Save shapes:
//   - Text only → enqueue create-note with content + the captureText role tag.
//   - Voice only → enqueue create-note (memo body placeholder) + upload-attachment
//     + link-attachment{transcribe:true}; vault's scribe pipeline replaces the
//     `_Transcript pending._` line once it's processed the audio.
//   - Both → enqueue create-note with the user's typed body AND attach audio
//     (no placeholder body — the user wrote one); both role tags applied.
// In every case any `#tag` patterns the user typed in the body are extracted
// and added so a typed thought like "got #idea today" surfaces under #idea.

type Phase =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "denied"; message: string }
  | { kind: "recording"; startedAt: number }
  | {
      kind: "have-audio";
      data: ArrayBuffer;
      mimeType: string;
      url: string;
      durationMs: number;
    }
  | { kind: "saving" };

const HASHTAG_RE = /(?:^|\s)#([a-zA-Z][\w-]*)/g;

export function extractHashtags(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(HASHTAG_RE)) {
    const tag = normalizeTag(m[1] ?? "");
    if (tag) out.add(tag);
  }
  return [...out];
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function Capture() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const pushToast = useToastStore((s) => s.push);
  const { db, blobStore, engine } = useSync();
  const { roles } = useTagRoles(activeVault?.id ?? null);

  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<RecorderController | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Tick the elapsed display while recording.
  useEffect(() => {
    if (phase.kind !== "recording") return;
    const id = setInterval(() => setElapsedMs(Date.now() - phase.startedAt), 250);
    return () => clearInterval(id);
  }, [phase]);

  // Revoke any preview URL on unmount so we don't leak blob: handles.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  // Focus the textarea on mount — typing should always be the no-friction path.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const startRecording = useCallback(async () => {
    if (phase.kind === "recording" || phase.kind === "requesting") return;
    setPhase({ kind: "requesting" });
    try {
      const mimeType = pickMimeType();
      if (!mimeType) {
        setPhase({
          kind: "denied",
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
      const message =
        perm.kind === "permission-denied"
          ? "Microphone access was denied. Update your browser's site settings to record."
          : perm.kind === "no-device"
            ? "No microphone was found on this device."
            : perm instanceof Error
              ? perm.message
              : "Microphone is not available in this browser.";
      setPhase({ kind: "denied", message });
    }
  }, [phase]);

  const stopRecording = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec || phase.kind !== "recording") return;
    try {
      const result = await rec.stop();
      recorderRef.current = null;
      const blob = new Blob([result.data], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = url;
      setPhase({
        kind: "have-audio",
        data: result.data,
        mimeType: result.mimeType,
        url,
        durationMs: result.durationMs,
      });
    } catch (e) {
      pushToast(
        e instanceof Error ? `Recording failed: ${e.message}` : "Recording failed.",
        "error",
      );
      setPhase({ kind: "idle" });
    }
  }, [phase, pushToast]);

  // Watch for pointerup anywhere — if the user presses the mic and slides
  // their finger off before releasing, we still want to stop on release.
  useEffect(() => {
    if (phase.kind !== "recording") return;
    const onUp = () => {
      void stopRecording();
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [phase, stopRecording]);

  const discardAudio = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPhase({ kind: "idle" });
    setElapsedMs(0);
  }, []);

  const reset = useCallback(() => {
    setContent("");
    setTags([]);
    setTagInput("");
    discardAudio();
    textareaRef.current?.focus();
  }, [discardAudio]);

  const hasAudio = phase.kind === "have-audio";
  const hasText = content.trim().length > 0;
  const canSubmit = (hasText || hasAudio) && phase.kind !== "saving";

  const save = useCallback(async () => {
    if (!canSubmit || !db || !activeVault) return;
    if (hasAudio && !blobStore) {
      pushToast("Sync queue not ready — try again in a moment.", "error");
      return;
    }
    const audio = phase.kind === "have-audio" ? phase : null;
    setPhase({ kind: "saving" });

    const explicitTags = tags.filter((t) => t.length > 0);
    const extracted = extractHashtags(content);
    const modeTags: string[] = [];
    if (hasText) modeTags.push(roles.captureText);
    if (audio) modeTags.push(roles.captureVoice);
    const finalTags = Array.from(
      new Set([...modeTags, ...explicitTags, ...extracted].filter((t) => t.length > 0)),
    );

    const localId = newLocalId();

    try {
      if (audio) {
        // Voice-bearing note. If the user typed too, keep their body verbatim
        // and let scribe append the transcript below the attachment. If they
        // didn't type, fall back to the standard memo placeholder so the note
        // reads sensibly while transcription is pending.
        const recordedAt = new Date();
        const filename = memoFilename(audio.mimeType, recordedAt);
        const blobId = newBlobId();
        const body = hasText
          ? `${content.trim()}\n\n_Transcript pending._\n\n![[${filename}]]\n`
          : `_Transcript pending._\n\n![[${filename}]]\n`;
        const path = hasText ? undefined : memoPath(recordedAt);

        if (!blobStore) throw new Error("blob store missing");
        await blobStore.put(blobId, audio.data, audio.mimeType, activeVault.id);
        await enqueue(
          db,
          {
            kind: "create-note",
            localId,
            payload: {
              content: body,
              ...(path ? { path } : {}),
              ...(finalTags.length ? { tags: finalTags } : {}),
            },
          },
          { vaultId: activeVault.id },
        );
        await enqueue(
          db,
          {
            kind: "upload-attachment",
            blobId,
            filename,
            mimeType: audio.mimeType,
          },
          { vaultId: activeVault.id },
        );
        await enqueue(
          db,
          {
            kind: "link-attachment",
            noteId: localId,
            pathRef: blobRef(blobId),
            mimeType: audio.mimeType,
            transcribe: true,
          },
          { vaultId: activeVault.id },
        );
      } else {
        // Text only.
        await enqueue(
          db,
          {
            kind: "create-note",
            localId,
            payload: {
              content,
              ...(finalTags.length ? { tags: finalTags } : {}),
            },
          },
          { vaultId: activeVault.id },
        );
      }
      void engine?.runOnce();
      pushToast(audio ? "Captured — syncing audio." : "Captured.", "success");
      reset();
    } catch (e) {
      pushToast(e instanceof Error ? `Capture failed: ${e.message}` : "Capture failed.", "error");
      // Restore the audio buffer so the user can retry without re-recording.
      if (audio) {
        setPhase({
          kind: "have-audio",
          data: audio.data,
          mimeType: audio.mimeType,
          url: audio.url,
          durationMs: audio.durationMs,
        });
      } else {
        setPhase({ kind: "idle" });
      }
    }
  }, [
    canSubmit,
    db,
    activeVault,
    blobStore,
    phase,
    hasAudio,
    hasText,
    tags,
    content,
    roles.captureText,
    roles.captureVoice,
    engine,
    pushToast,
    reset,
  ]);

  // Cmd/Ctrl+Enter submits — same shortcut TextCapture used to have.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void save();
      }
    },
    [save],
  );

  // Unmount-flush: TextCapture used to silently enqueue draft text on nav-away
  // so a tab switch never lost work. Preserve that for the unified surface.
  // Audio in `have-audio` is intentionally *not* flushed — it's bigger, and
  // saving an attachment without the user clicking Capture feels wrong.
  const latest = useRef({ db, activeVaultId: activeVault?.id ?? null, content, tags, roles });
  latest.current = { db, activeVaultId: activeVault?.id ?? null, content, tags, roles };
  useEffect(() => {
    return () => {
      const { db, activeVaultId, content, tags, roles } = latest.current;
      const text = content.trim();
      if (!text || !db || !activeVaultId) return;
      const explicit = tags.filter((t) => t.length > 0);
      const extracted = extractHashtags(content);
      const all = Array.from(
        new Set([roles.captureText, ...explicit, ...extracted].filter((t) => t.length > 0)),
      );
      void enqueue(
        db,
        {
          kind: "create-note",
          localId: newLocalId(),
          payload: {
            content,
            ...(all.length ? { tags: all } : {}),
          },
        },
        { vaultId: activeVaultId },
      );
    };
  }, []);

  if (!activeVault) return <Navigate to="/" replace />;

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 md:px-6 md:py-8">
      <header className="mb-5">
        <h1 className="font-serif text-2xl text-fg md:text-3xl">Capture</h1>
        <p className="mt-1 text-xs text-fg-dim">
          Type a thought, hold the mic to record, or both.{" "}
          <kbd className="rounded bg-bg/60 px-1">⌘</kbd>
          <kbd className="rounded bg-bg/60 px-1">↵</kbd> to send.
        </p>
      </header>

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 md:p-6">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="What are you thinking?"
          aria-label="Capture content"
          rows={8}
          disabled={phase.kind === "saving"}
          className="min-h-[30vh] w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none disabled:opacity-60"
        />

        {phase.kind === "have-audio" ? (
          <div className="flex flex-col gap-2 rounded-md border border-accent/30 bg-accent/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-fg-muted">
                🎙 Recorded {formatElapsed(phase.durationMs)}
              </span>
              <button
                type="button"
                onClick={discardAudio}
                className="text-xs text-fg-dim hover:text-red-400"
              >
                Discard
              </button>
            </div>
            <audio controls src={phase.url} className="w-full">
              <track kind="captions" />
            </audio>
            <p className="text-xs text-fg-dim">
              Transcript will be appended once your vault processes it.
            </p>
          </div>
        ) : null}

        {phase.kind === "denied" ? (
          <p className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
            {phase.message}
          </p>
        ) : null}

        <TagEditor
          tags={tags}
          input={tagInput}
          onInputChange={setTagInput}
          onAdd={(raw) => {
            const t = normalizeTag(raw);
            if (!t || tags.includes(t)) return;
            setTags((prev) => [...prev, t]);
            setTagInput("");
          }}
          onRemove={(name) => setTags((prev) => prev.filter((x) => x !== name))}
        />

        <div className="flex items-center justify-between gap-3 pt-2">
          <MicButton
            phase={phase}
            elapsedMs={elapsedMs}
            onPointerDown={() => void startRecording()}
          />
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSubmit}
              className="min-h-11 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {phase.kind === "saving" ? "Saving…" : "Capture"}
            </button>
            <span className="text-[11px] text-fg-dim">
              {hasAudio && hasText
                ? "Will save as a note with audio attached."
                : hasAudio
                  ? "Will save as a voice memo."
                  : hasText
                    ? "Will save as a text note."
                    : "Type or record to capture."}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

function MicButton({
  phase,
  elapsedMs,
  onPointerDown,
}: {
  phase: Phase;
  elapsedMs: number;
  onPointerDown: () => void;
}) {
  const isRecording = phase.kind === "recording";
  const isRequesting = phase.kind === "requesting";
  const label = isRecording
    ? `Recording — release to stop (${formatElapsed(elapsedMs)})`
    : isRequesting
      ? "Requesting microphone…"
      : "Hold to record";
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        // Suppress the implicit click that follows pointerup so the button's
        // active state matches what the user is actually doing.
        e.preventDefault();
        onPointerDown();
      }}
      aria-label={label}
      aria-pressed={isRecording}
      disabled={phase.kind === "saving"}
      className={`flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition select-none ${
        isRecording
          ? "border-red-500/40 bg-red-500/10 text-red-400"
          : "border-accent/30 bg-accent/10 text-accent hover:bg-accent/15"
      } disabled:opacity-40`}
    >
      <span aria-hidden="true" className={isRecording ? "animate-pulse" : ""}>
        🎙
      </span>
      <span>
        {isRecording
          ? `Rec ${formatElapsed(elapsedMs)}`
          : isRequesting
            ? "Requesting…"
            : "Hold to record"}
      </span>
    </button>
  );
}
