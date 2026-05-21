import { TagEditor, normalizeTag } from "@/components/TagEditor";
import {
  type PermissionError,
  type RecorderController,
  createRecorder,
  memoFilename,
  pickMimeType,
  quickPath,
  requestMic,
} from "@/lib/capture/recorder";
import { blobRef, enqueue, newBlobId, newLocalId } from "@/lib/sync";
import { relativeTime } from "@/lib/time";
import { useToastStore } from "@/lib/toast/store";
import { useTagRoles, useVaultStore } from "@/lib/vault";
import { useActiveVaultClient } from "@/lib/vault/queries";
import { ensureNotesSchema } from "@/lib/vault/schema-ensure";
import { useSync } from "@/providers/SyncProvider";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router";

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

export function Capture({
  moreFieldsOpenDefault = false,
}: { moreFieldsOpenDefault?: boolean } = {}) {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const pushToast = useToastStore((s) => s.push);
  const { db, blobStore, engine } = useSync();
  const { roles } = useTagRoles(activeVault?.id ?? null);
  const client = useActiveVaultClient();

  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  // "More fields" — the audit's escape hatch from the quick-capture default.
  // Hidden by default so the textarea stays the no-friction focus; an
  // operator who needs to override the path or set a one-line summary
  // opens this and gets the structured form without leaving Capture.
  //
  // pathOverride is pre-filled with `quickPath()` (notes#126). After save
  // success, `reset()` regenerates the path so a second capture in the same
  // mount doesn't collide on the prior second — but ONLY when the operator
  // hasn't manually edited the value (`pathEditedRef` tracks that). An
  // empty input at save time reverts to `generatedPathRef.current` (option
  // d, notes#126 reshape — never falls back to vault-auto-assign). Aaron's
  // framing: surface the path-gen, don't hide it behind vault magic.
  const [moreFieldsOpen, setMoreFieldsOpen] = useState(moreFieldsOpenDefault);
  const generatedPathRef = useRef(quickPath());
  const pathEditedRef = useRef(false);
  const [pathOverride, setPathOverrideRaw] = useState<string>(() => generatedPathRef.current);
  // Wrap setPathOverride so any user-typed value distinct from the
  // last-generated path flips the "edited" flag. Restoring the generated
  // value (or clearing the field) clears the flag.
  const setPathOverride = useCallback((next: string) => {
    pathEditedRef.current = next.trim() !== "" && next !== generatedPathRef.current;
    setPathOverrideRaw(next);
  }, []);
  const [summary, setSummary] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [elapsedMs, setElapsedMs] = useState(0);
  // Background draft-save state (notes#127-followup, rc.10):
  //
  // Autosave used to call the full `save()` which set phase=saving (disabling
  // the textarea) and called `reset()` (clearing content). Aaron's
  // mid-thought typing got wiped. The redesign: autosave writes a DRAFT —
  // it enqueues create-note on first fire, then update-note on subsequent
  // fires (same localId), and NEVER touches phase or content. The user
  // keeps typing into the same textarea; the draft updates in the
  // background. Manual Capture is still the "I'm done" finalize action:
  // if a draft is in flight, it enqueues update-note (the create already
  // shipped) and clears the draft state on reset.
  //
  // draftRef.current === null means no draft is in flight. Once a draft
  // exists, `createCommitted` is set SYNCHRONOUSLY before draftSave's
  // create-note enqueue await (notes#135 race fix) — so a parallel
  // save() or unmount-flush in the same tick sees the post-create state
  // and routes to update-note. IndexedDB's autoincrement `seq` orders
  // the create before any racing update by call order, so FIFO drain
  // sees create-then-update regardless of which await resolves first.
  // If the create enqueue itself throws, draftSave's catch block
  // resets the ref back to null so the next attempt creates fresh.
  const draftRef = useRef<{
    localId: string;
    createCommitted: boolean;
  } | null>(null);
  // Wall-clock ms of the most recent successful background draft save.
  // Drives the "Draft saved · just now" indicator next to the textarea.
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  // Re-render tick for the "Draft saved · just now" indicator (notes#135).
  // `relativeTime()` is computed at render time from `draftSavedAt`, but
  // nothing else in this component changes while the user idles after a
  // draft has landed — so the label could stay at "just now" for the full
  // 5s autosave window even though wall-clock has advanced. Bumping this
  // every 15s while a draft is in flight forces a re-render so the label
  // tracks reality without polling when there's nothing to show.
  const [indicatorTick, setIndicatorTick] = useState(0);

  const recorderRef = useRef<RecorderController | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Set synchronously by save() before any await so an unmount that fires in
  // the same tick (user hits Capture and immediately navigates) can detect
  // an in-flight enqueue and skip the unmount-flush. A render-tracked phase
  // ref isn't enough — React may not re-render before the unmount.
  const savingRef = useRef(false);

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
    // Finalize the current capture session — clear background draft state
    // too. The next note typed in this mount starts a fresh draft.
    draftRef.current = null;
    setDraftSavedAt(null);
    setContent("");
    setTags([]);
    setTagInput("");
    // Path-collision fix (notes#126 reshape, raised in #130 review):
    // regenerate the default `quickPath()` so a second capture on the same
    // mount doesn't collide with the first one's second-granularity path.
    // Only when the operator hasn't manually edited — if they typed an
    // explicit path (e.g. "Daily/2026-05-12") they probably want to keep
    // capturing into it. `pathEditedRef` tracks that intent (set by the
    // setPathOverride wrapper).
    if (!pathEditedRef.current) {
      const fresh = quickPath();
      generatedPathRef.current = fresh;
      setPathOverrideRaw(fresh);
    }
    // Don't clear summary — same reasoning as the audit's "More fields"
    // deliberate-open: the user is in structured-form mode and silently
    // resetting their typed summary would be surprising.
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
    savingRef.current = true;
    setPhase({ kind: "saving" });

    const explicitTags = tags.filter((t) => t.length > 0);
    const extracted = extractHashtags(content);
    const modeTags: string[] = [];
    if (hasText) modeTags.push(roles.captureText);
    if (audio) modeTags.push(roles.captureVoice);
    const finalTags = Array.from(
      new Set([...modeTags, ...explicitTags, ...extracted].filter((t) => t.length > 0)),
    );

    // For the text-only path, prefer the in-flight draft's localId so the
    // manual Capture click finalizes the same note the autosave was
    // building — otherwise we'd duplicate. For audio captures (no draft
    // path) and the no-draft text case, mint a fresh id.
    const draft = draftRef.current;
    const localId = draft?.localId ?? newLocalId();

    // Path resolution (notes#126 reshape, option d): empty input reverts to
    // the mount-time generated value — clearing the path never hands
    // generation back to the vault. Summary trim drops empty-string noise.
    const pathToSave = pathOverride.trim() || generatedPathRef.current;
    const summaryValue = summary.trim();
    const metadata = summaryValue ? { summary: summaryValue } : undefined;

    // Schema-ensure (notes#126 reshape) — fire-and-forget per-session,
    // per-vault. Idempotent vault-side; refs in schema-ensure.ts gate
    // repeat calls. Failures don't block the capture; the next save
    // retries. We DON'T await this — it can race with the create-note
    // enqueue safely because vault accepts notes with as-yet-unwritten
    // tag-identity rows (the tag-identity is for hierarchy queries, not
    // create-note validation).
    if (client) {
      void ensureNotesSchema(activeVault.id, client);
    }

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
        // Option (d): one canonical Notes-side path rule, no phase-dependent
        // forks. What the operator saw in More fields is what gets written.
        const path = pathToSave;

        if (!blobStore) throw new Error("blob store missing");
        await blobStore.put(blobId, audio.data, audio.mimeType, activeVault.id);
        await enqueue(
          db,
          {
            kind: "create-note",
            localId,
            payload: {
              content: body,
              path,
              ...(finalTags.length ? { tags: finalTags } : {}),
              ...(metadata ? { metadata } : {}),
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
      } else if (draft?.createCommitted) {
        // Finalize an in-flight background draft (rc.10). The create-note
        // already shipped via the first autosave; enqueue an update-note
        // with the latest content + tags + path. `path` and `tags` go
        // through here too because the operator may have edited them in
        // More-fields between autosaves and the manual Capture click.
        await enqueue(
          db,
          {
            kind: "update-note",
            targetId: localId,
            payload: {
              content,
              path: pathToSave,
              ...(finalTags.length ? { tags: { add: finalTags } } : {}),
              ...(metadata ? { metadata } : {}),
            },
          },
          { vaultId: activeVault.id },
        );
      } else {
        // Text only, no draft in flight — fresh create.
        await enqueue(
          db,
          {
            kind: "create-note",
            localId,
            payload: {
              content,
              path: pathToSave,
              ...(finalTags.length ? { tags: finalTags } : {}),
              ...(metadata ? { metadata } : {}),
            },
          },
          { vaultId: activeVault.id },
        );
      }
      void engine?.runOnce();
      pushToast(audio ? "Captured — syncing audio." : "Captured.", "success");
      reset();
      // Critical: setPhase wasn't reset to idle here in rc.9 — `canSubmit`
      // stayed false for the rest of the mount and the textarea
      // (disabled={phase === "saving"}) stayed locked. Flip back to idle so
      // the user can keep capturing on the same mount. rc.10 fix.
      setPhase({ kind: "idle" });
      // Release the in-flight flag so the unmount-flush will still flush a
      // later draft if the user keeps typing. Pre-rc.10 this was already
      // critical; with the new draft-save loop it stays so.
      savingRef.current = false;
    } catch (e) {
      pushToast(e instanceof Error ? `Capture failed: ${e.message}` : "Capture failed.", "error");
      // Save failed — release the in-flight flag so the unmount-flush will
      // still flush a draft if the user edits more text and navigates away.
      // Without this, a single failed save would silently swallow every
      // subsequent draft on the same mount.
      savingRef.current = false;
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
    client,
    phase,
    hasAudio,
    hasText,
    tags,
    content,
    pathOverride,
    summary,
    roles.captureText,
    roles.captureVoice,
    engine,
    pushToast,
    reset,
  ]);

  // Background draft save — runs from the 5s inactivity timer. Unlike
  // save() this NEVER touches phase (no textarea disable), NEVER clears
  // content, and quietly retries the next tick if the queue isn't ready
  // (no toast). First call enqueues create-note; subsequent calls on the
  // same mount enqueue update-note targeting the same localId.
  //
  // Audio is deliberately not handled here — autosave is suppressed when
  // phase is "have-audio" (the user's explicit Capture action finalizes
  // audio + content together).
  const draftSave = useCallback(async () => {
    if (!db || !activeVault) return;
    if (phase.kind !== "idle") return;
    if (!hasText) return;

    const explicit = tags.filter((t) => t.length > 0);
    const extracted = extractHashtags(content);
    const all = Array.from(
      new Set([roles.captureText, ...explicit, ...extracted].filter((t) => t.length > 0)),
    );
    const pathValue = pathOverride.trim() || generatedPathRef.current;
    const summaryValue = summary.trim();
    const metadata = summaryValue ? { summary: summaryValue } : undefined;

    // Snapshot whether we're about-to-create vs already-created BEFORE the
    // await so the catch block can roll back accurately. notes#135 race
    // fix: the ref flips to `createCommitted: true` SYNCHRONOUSLY here
    // (before any await) so a parallel `save()` or unmount-flush in the
    // same tick sees the post-create state and routes to update-note. The
    // create-note's `db.add()` will still receive a lower autoincrement
    // `seq` than any racing update-note (IndexedDB serializes add() by
    // call order), so FIFO drain processes create-then-update correctly
    // regardless of which await resolves first.
    const draftBefore = draftRef.current;
    const isFreshCreate = !draftBefore;
    const localId = draftBefore?.localId ?? newLocalId();
    if (isFreshCreate) {
      draftRef.current = { localId, createCommitted: true };
    }
    try {
      if (isFreshCreate) {
        await enqueue(
          db,
          {
            kind: "create-note",
            localId,
            payload: {
              content,
              path: pathValue,
              ...(all.length ? { tags: all } : {}),
              ...(metadata ? { metadata } : {}),
            },
          },
          { vaultId: activeVault.id },
        );
      } else {
        await enqueue(
          db,
          {
            kind: "update-note",
            targetId: localId,
            payload: {
              content,
              path: pathValue,
              ...(all.length ? { tags: { add: all } } : {}),
              ...(metadata ? { metadata } : {}),
            },
          },
          { vaultId: activeVault.id },
        );
      }
      void engine?.runOnce();
      setDraftSavedAt(Date.now());
    } catch {
      // Draft save is best-effort — silent failure. The next tick will
      // retry; the unmount-flush is the last-ditch safety net. If the
      // *create* attempt failed, roll the ref back to null so the next
      // draftSave attempt creates fresh instead of update-noting a
      // never-created targetId. Update-note failures don't touch the ref
      // — the create already shipped, the next attempt should retry as
      // an update.
      if (isFreshCreate) {
        draftRef.current = null;
      }
    }
  }, [
    db,
    activeVault,
    phase.kind,
    hasText,
    content,
    tags,
    pathOverride,
    summary,
    roles.captureText,
    engine,
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
  // savingRef is checked here so a teardown that fires in the same tick as a
  // Capture click (user hits Capture and immediately navigates) sees that
  // save() is already in flight and bails — otherwise we'd enqueue twice.
  const latest = useRef({
    db,
    activeVaultId: activeVault?.id ?? null,
    content,
    tags,
    pathOverride,
    summary,
    roles,
  });
  latest.current = {
    db,
    activeVaultId: activeVault?.id ?? null,
    content,
    tags,
    pathOverride,
    summary,
    roles,
  };
  useEffect(() => {
    return () => {
      if (savingRef.current) return;
      const { db, activeVaultId, content, tags, pathOverride, summary, roles } = latest.current;
      const text = content.trim();
      if (!text || !db || !activeVaultId) return;
      const explicit = tags.filter((t) => t.length > 0);
      const extracted = extractHashtags(content);
      const all = Array.from(
        new Set([roles.captureText, ...explicit, ...extracted].filter((t) => t.length > 0)),
      );
      // Same path-resolution as save() (option d): trimmed override OR
      // the mount-time generated path. Never write `path: undefined` to
      // the queue — the path is always Notes-side.
      const pathValue = pathOverride.trim() || generatedPathRef.current;
      const summaryValue = summary.trim();
      // Swallow rejections here — we're in the unmount path, so there's no
      // user-visible surface to report a failure (the toaster has already
      // been torn down with the providers). The typical failure mode in
      // tests is the SyncProvider closing its IDB handle in the same tick;
      // in production the queue is more durable. Either way, no UI to
      // notify.
      //
      // If a background draft is in flight (rc.10 draft-save loop), update
      // that note instead of creating a new one — otherwise nav-away
      // duplicates the draft as a fresh note. The create-note (if any was
      // enqueued by the first autosave) already shipped its content; this
      // PATCH just brings the post-autosave keystrokes along.
      const draft = draftRef.current;
      const enqueuePromise = draft?.createCommitted
        ? enqueue(
            db,
            {
              kind: "update-note",
              targetId: draft.localId,
              payload: {
                content,
                path: pathValue,
                ...(all.length ? { tags: { add: all } } : {}),
                ...(summaryValue ? { metadata: { summary: summaryValue } } : {}),
              },
            },
            { vaultId: activeVaultId },
          )
        : enqueue(
            db,
            {
              kind: "create-note",
              localId: draft?.localId ?? newLocalId(),
              payload: {
                content,
                path: pathValue,
                ...(all.length ? { tags: all } : {}),
                ...(summaryValue ? { metadata: { summary: summaryValue } } : {}),
              },
            },
            { vaultId: activeVaultId },
          );
      enqueuePromise.catch(() => {
        // best-effort flush on nav-away
      });
    };
  }, []);

  // Indicator-tick refresh (notes#135). Re-render the "Draft saved" pill
  // every 15s while `draftSavedAt` is set so `relativeTime()` keeps
  // tracking wall-clock. Otherwise the label would freeze at "just now"
  // for the full 5s autosave window (and longer, if the user idles after
  // a finalized draft) because nothing else in the component changes.
  // Guarded by `draftSavedAt !== null` so we don't spin a timer in the
  // common idle-empty case. INDICATOR_TICK_MS is small enough that the
  // label stays in step with `relativeTime()`'s minute-grain output —
  // by the time a single minute rolls over (the first label change from
  // "just now" to "1m ago") we've ticked four times.
  useEffect(() => {
    if (draftSavedAt === null) return;
    const id = setInterval(() => {
      setIndicatorTick((n) => n + 1);
    }, 15_000);
    return () => clearInterval(id);
  }, [draftSavedAt]);

  // Inactivity autosave (5s) — fires `draftSave()` after the user stops
  // editing for 5 seconds. Saves a partial as a background draft (notes
  // #127-followup rc.10 redesign): first fire enqueues create-note, each
  // subsequent fire enqueues update-note for the same localId. Never
  // clears content; never disables the textarea. The manual Capture
  // click is the finalize step.
  //
  // Skipped while audio is staged (audio capture is finalize-only, the
  // user's explicit Capture-click decision), while recording (mid-state),
  // and while body is empty (nothing to save).
  //
  // `tags`, `pathOverride`, `summary` are intentional debounce triggers —
  // a change in any of them must reset this 5s timer so the autosave
  // fires 5s after the LAST edit. They're read by `draftSave` via its
  // closure (hence Biome can't see them used).
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (phase.kind === "recording" || phase.kind === "requesting" || phase.kind === "saving") {
      return;
    }
    if (phase.kind === "have-audio") return;
    if (!hasText) return;
    const id = setTimeout(() => {
      if (savingRef.current) return;
      void draftSave();
    }, 5000);
    return () => clearTimeout(id);
  }, [phase.kind, hasText, content, tags, pathOverride, summary, draftSave]);

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

        {draftSavedAt !== null ? (
          <p
            className="-mt-2 text-right text-[11px] text-fg-dim"
            aria-live="polite"
            // Tag the indicator element with the tick so it's a node-level
            // read of the bumped state — keeps Biome quiet about an unused
            // value AND re-renders the label as wall-clock advances. The
            // attribute itself is inert; the React work is the point.
            data-indicator-tick={indicatorTick}
          >
            Draft saved · {relativeTime(new Date(draftSavedAt).toISOString())}
          </p>
        ) : null}

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

        <details
          className="group rounded-md border border-border bg-bg/50"
          open={moreFieldsOpen}
          onToggle={(e) => setMoreFieldsOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer select-none px-3 py-2 text-xs text-fg-muted hover:text-accent">
            More fields
          </summary>
          <div className="space-y-3 px-3 pb-3 pt-1">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-fg-dim">Path</span>
              <input
                type="text"
                value={pathOverride}
                onChange={(e) => setPathOverride(e.target.value)}
                placeholder="(blank → uses generated path)"
                aria-label="Path override"
                className="rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-xs text-fg focus:border-accent focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-fg-dim">Summary</span>
              <input
                type="text"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="(optional one-line description)"
                aria-label="Summary"
                className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-fg focus:border-accent focus:outline-none"
              />
            </label>
            <p className="text-xs text-fg-dim">
              Need to attach a file?{" "}
              <Link to="/new" className="text-accent hover:underline">
                Open the full editor
              </Link>
              .
            </p>
          </div>
        </details>

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
