/**
 * PWA helpers for Notes.
 *
 * The SW-reload helper used to live here in full; Phase 2 of the
 * notes-migration-to-app arc (parachute-app#6, design doc section 16)
 * moved it into `@openparachute/app-client/sw-reload` so any future PWA-
 * mode app inherits Notes' load-bearing reload behavior without
 * copy-pasting. The platform sniffers (`isStandalone`, `isIOS`) and the
 * BeforeInstallPromptEvent type stay Notes-side — they're install-banner
 * UX wiring, not general-purpose enough yet to lift out.
 */

export {
  SW_RELOAD_FALLBACK_MS,
  __resetReloadArmedForTests,
  reloadAfterServiceWorkerUpdate,
} from "@openparachute/app-client";

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
