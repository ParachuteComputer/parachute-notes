import {
  TEXT_SIZES,
  type TextSize,
  applyTextSize,
  nextTextSize,
  previousTextSize,
  readStoredTextSize,
  textSizeLabel,
  writeStoredTextSize,
} from "@/lib/text-size";
import { useCallback, useEffect, useRef, useState } from "react";

// Header chrome control + global keyboard shortcuts for text-size. The
// Settings dropdown (notes#123) is canonical for "set my preferred size";
// this surface exists because text-zoom is an in-the-moment action (notes
// #127: "usually I'm in the middle of typing a note when I want to
// increase the size"). Two paths:
//
//   1. Click the "Aa" button (`TextSizeControl`) → 3-option popover.
//   2. Cmd+Plus / Cmd+Minus / Cmd+0 — bound by `TextSizeShortcutsMount`,
//      which is rendered once at the app root so the listener never
//      double-binds when the mobile menu (a second `TextSizeControl`
//      instance) opens.
//
// Both invoke the same store + apply helpers from lib/text-size.ts —
// localStorage is the single source of truth so all surfaces (Settings,
// header button, shortcuts) stay synchronized via the storage key. The
// local `size` state in `TextSizeControl` is just a UI mirror so the
// popover renders the right "current" pill; it's read fresh from
// localStorage by the global shortcut handler so a click on one surface
// doesn't stale-out the other.

// Custom event the popover listens for so the visible "current" indicator
// stays in sync when the keyboard shortcut (or any other same-tab caller)
// changes the size. `storage` events don't fire on the writer tab, so we
// need a same-tab signal alongside the cross-tab one.
const TEXT_SIZE_CHANGE_EVENT = "notes:text-size-change";

function broadcast(next: TextSize) {
  writeStoredTextSize(next);
  applyTextSize(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<TextSize>(TEXT_SIZE_CHANGE_EVENT, { detail: next }));
  }
}

// Mount once at the app root — renders no DOM. Separate from the visible
// `TextSizeControl` because the Header renders that twice (desktop +
// mobile menu) and we don't want two keydown listeners firing in parallel
// when both surfaces are mounted.
export function TextSizeShortcutsMount() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.altKey || e.shiftKey) return;
      // Cmd+= / Cmd+Plus — many keyboards report "=" without shift even
      // for the visible Plus glyph (same physical key). Treat both as
      // "step up".
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        broadcast(nextTextSize(readStoredTextSize()));
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        broadcast(previousTextSize(readStoredTextSize()));
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        broadcast("default");
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}

export function TextSizeControl() {
  const [size, setSize] = useState<TextSize>(() => readStoredTextSize());
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Wraps the persist+apply+mirror trio so callers (popover buttons,
  // future onChange consumers) don't have to remember the order. Also
  // broadcasts the same-tab change event so a sibling TextSizeControl
  // (mobile menu) sees the new value without waiting for storage tick.
  const set = useCallback((next: TextSize) => {
    setSize(next);
    broadcast(next);
  }, []);

  // Stay in sync when *another* surface changes the size. `storage` covers
  // the cross-tab case (Settings in tab A → header in tab B); the custom
  // `TEXT_SIZE_CHANGE_EVENT` covers the same-tab case (shortcut fires while
  // popover is open, or sibling TextSizeControl in the mobile menu writes).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "notes:textSize") return;
      setSize(readStoredTextSize());
    };
    const onLocal = (e: Event) => {
      const detail = (e as CustomEvent<TextSize>).detail;
      if (detail) setSize(detail);
      else setSize(readStoredTextSize());
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(TEXT_SIZE_CHANGE_EVENT, onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(TEXT_SIZE_CHANGE_EVENT, onLocal);
    };
  }, []);

  // Close the popover on click-outside. Same shape as SyncStatusIndicator.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`Text size: ${textSizeLabel(size)}. Click to change.`}
        aria-expanded={open}
        title={`Text size: ${textSizeLabel(size)}`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-card px-2 py-1.5 text-sm text-fg-muted hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span aria-hidden="true" className="font-serif">
          A<span className="text-xs">a</span>
        </span>
      </button>

      {open ? (
        // biome-ignore lint/a11y/useSemanticElements: a native <dialog> requires imperative show()/showModal() calls; this is a popover, not a modal.
        <div
          role="dialog"
          aria-label="Text size"
          className="absolute right-0 z-30 mt-2 w-40 rounded-md border border-border bg-card p-2 text-sm shadow-lg"
        >
          <ul className="flex flex-col gap-0.5">
            {TEXT_SIZES.map((s) => {
              const active = s === size;
              return (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => {
                      set(s);
                      setOpen(false);
                    }}
                    aria-pressed={active}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-bg/60 ${
                      active ? "text-accent" : "text-fg-muted"
                    }`}
                  >
                    <span>{textSizeLabel(s)}</span>
                    {active ? (
                      <span aria-hidden="true" className="text-xs">
                        ✓
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
