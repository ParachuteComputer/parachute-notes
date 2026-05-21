// BeforeInstallPromptEvent isn't in lib.dom yet — declare what we use.
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

export function isStandalone(nav: Navigator = navigator, win: Window = window): boolean {
  if (win.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari exposes navigator.standalone on installed PWAs.
  return (nav as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIOS(
  ua: string = navigator.userAgent,
  hasTouch: boolean = typeof document !== "undefined" && navigator.maxTouchPoints > 1,
): boolean {
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports a Mac UA but has a touch screen — use that signal.
  return /Macintosh/.test(ua) && hasTouch;
}

// How long we wait for `navigator.serviceWorker.controllerchange` after asking
// the waiting SW to skipWaiting before giving up and forcing a reload anyway.
// 2.5s comfortably covers a fast activate-and-claim, but is short enough that
// the user isn't left staring at a banner that "did nothing" if the event
// path silently fails. Exported so tests can shorten it via the optional
// parameter on `reloadAfterServiceWorkerUpdate`.
export const SW_RELOAD_FALLBACK_MS = 2500;

// Module-level guard so a double-click on the Reload button (or a re-render
// in the same tab) can't queue up two reloads racing each other. Reset on
// next page load by virtue of being module state.
let reloadArmed = false;

/**
 * Reload the page once the waiting service worker takes control.
 *
 * vite-plugin-pwa's `useRegisterSW` registers its own `controlling` listener
 * inside `showSkipWaitingPrompt` to handle the reload, but in real PWAs that
 * event can be missed (listener attached after the activation already fired,
 * iOS standalone quirks, BFCache restores re-using a controller without
 * re-firing controllerchange). When that happens, clicking Reload appears to
 * do nothing — the new SW activated, but the page never refreshed.
 *
 * Wire this BEFORE calling `updateServiceWorker(true)` so the listener is
 * armed when the SW transitions. The fallback timeout catches the rare
 * case where the event never fires at all — better to force a reload
 * after a beat than to leave the user stuck.
 *
 * Idempotent within a page load: a second call is a no-op so a stray
 * re-click can't queue multiple reloads racing each other.
 */
export function reloadAfterServiceWorkerUpdate(
  opts: {
    fallbackMs?: number;
    reload?: () => void;
    serviceWorker?: ServiceWorkerContainer | null;
  } = {},
): void {
  if (reloadArmed) return;
  reloadArmed = true;

  const reload =
    opts.reload ??
    (() => {
      // `window.location.reload()` runs after the new SW is in control, so
      // the next navigation request gets served by the fresh script.
      window.location.reload();
    });
  const sw =
    opts.serviceWorker ??
    (typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? navigator.serviceWorker
      : null);
  const fallbackMs = opts.fallbackMs ?? SW_RELOAD_FALLBACK_MS;

  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    reload();
  };

  if (sw) {
    sw.addEventListener("controllerchange", fire, { once: true });
  }

  // Hard fallback — if controllerchange never fires (event missed, SW path
  // disabled, browser quirk) the user still gets a reload after a short
  // wait. Without this, the click silently does nothing.
  setTimeout(fire, fallbackMs);
}

// Test-only: reset the module-level "reload armed" flag so individual test
// cases start from a clean state. Not exported via the package barrel; only
// imported by the unit tests.
export function __resetReloadArmedForTests(): void {
  reloadArmed = false;
}
