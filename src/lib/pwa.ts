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
