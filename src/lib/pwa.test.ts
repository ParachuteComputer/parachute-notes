import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SW_RELOAD_FALLBACK_MS,
  __resetReloadArmedForTests,
  isIOS,
  isStandalone,
  reloadAfterServiceWorkerUpdate,
} from "./pwa";

describe("isIOS", () => {
  it("is true for iPhone UA", () => {
    expect(isIOS("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit")).toBe(true);
  });
  it("is true for iPad UA", () => {
    expect(isIOS("Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)")).toBe(true);
  });
  it("is true for iPadOS 13+ which reports a Mac UA but has touch", () => {
    expect(isIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", true)).toBe(true);
  });
  it("is false for desktop Chrome on macOS (no touch)", () => {
    expect(isIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/120", false)).toBe(false);
  });
  it("is false for Android UA", () => {
    expect(isIOS("Mozilla/5.0 (Linux; Android 13; Pixel 7)", true)).toBe(false);
  });
});

describe("isStandalone", () => {
  it("is true when display-mode: standalone matches", () => {
    const nav = { userAgent: "x" } as Navigator;
    const win = {
      matchMedia: (q: string) => ({ matches: q === "(display-mode: standalone)" }),
    } as unknown as Window;
    expect(isStandalone(nav, win)).toBe(true);
  });
  it("is true when navigator.standalone is true (iOS installed)", () => {
    const nav = { userAgent: "x", standalone: true } as Navigator & { standalone: boolean };
    const win = { matchMedia: () => ({ matches: false }) } as unknown as Window;
    expect(isStandalone(nav, win)).toBe(true);
  });
  it("is false in a regular browser tab", () => {
    const nav = { userAgent: "x" } as Navigator;
    const win = { matchMedia: () => ({ matches: false }) } as unknown as Window;
    expect(isStandalone(nav, win)).toBe(false);
  });
});

// notes#148 — the Reload button on the SW-update banner used to call only
// `updateServiceWorker(true)` and trust workbox-window's own controlling
// listener to reload. That listener can be missed in real PWAs, leaving
// the user with a banner that visibly does nothing on click. This util
// fires `window.location.reload()` on whichever signal lands first:
// `controllerchange`, or a hard fallback timeout.
describe("reloadAfterServiceWorkerUpdate", () => {
  beforeEach(() => {
    __resetReloadArmedForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    __resetReloadArmedForTests();
    vi.useRealTimers();
  });

  function makeSW(): {
    container: ServiceWorkerContainer;
    fireControllerChange: () => void;
  } {
    const listeners = new Set<EventListener>();
    const container = {
      addEventListener: vi.fn(
        (event: string, listener: EventListener, opts?: AddEventListenerOptions) => {
          if (event !== "controllerchange") return;
          const wrapped: EventListener = (e) => {
            if (opts?.once) listeners.delete(wrapped);
            listener(e);
          };
          listeners.add(wrapped);
        },
      ),
    } as unknown as ServiceWorkerContainer;
    return {
      container,
      fireControllerChange: () => {
        for (const l of [...listeners]) l(new Event("controllerchange"));
      },
    };
  }

  it("reloads when controllerchange fires", () => {
    const reload = vi.fn();
    const { container, fireControllerChange } = makeSW();
    reloadAfterServiceWorkerUpdate({ reload, serviceWorker: container });
    expect(reload).not.toHaveBeenCalled();
    fireControllerChange();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads via the fallback timeout when controllerchange never fires", () => {
    const reload = vi.fn();
    const { container } = makeSW();
    reloadAfterServiceWorkerUpdate({ reload, serviceWorker: container });
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SW_RELOAD_FALLBACK_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads exactly once when both signals fire", () => {
    const reload = vi.fn();
    const { container, fireControllerChange } = makeSW();
    reloadAfterServiceWorkerUpdate({ reload, serviceWorker: container, fallbackMs: 50 });
    fireControllerChange();
    vi.advanceTimersByTime(100);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — a second call does not arm a second reload", () => {
    const reload = vi.fn();
    const { container, fireControllerChange } = makeSW();
    reloadAfterServiceWorkerUpdate({ reload, serviceWorker: container, fallbackMs: 50 });
    reloadAfterServiceWorkerUpdate({ reload, serviceWorker: container, fallbackMs: 50 });
    fireControllerChange();
    vi.advanceTimersByTime(100);
    // Listener path fired once for the first call; the second call returned
    // early so it didn't add another listener or schedule a second timeout.
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("falls back to the timeout when no serviceWorker container is available", () => {
    const reload = vi.fn();
    reloadAfterServiceWorkerUpdate({ reload, serviceWorker: null, fallbackMs: 100 });
    vi.advanceTimersByTime(100);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
