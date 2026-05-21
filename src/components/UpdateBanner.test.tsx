import { UpdateBanner } from "@/components/UpdateBanner";
import { __resetReloadArmedForTests } from "@/lib/pwa";
import { __getPwaTestRig, __getPwaUpdateCalls, __resetPwaTestRig } from "@/test/stubs/pwa-register";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The `virtual:pwa-register/react` module is aliased to a test stub (see
// vitest.config.ts) that returns needRefresh=false by default. This smoke
// test proves the component imports the stub, renders without crashing,
// and correctly renders nothing when there's no pending update.
describe("UpdateBanner", () => {
  beforeEach(() => {
    __resetPwaTestRig();
    __resetReloadArmedForTests();
  });
  afterEach(() => {
    __resetPwaTestRig();
    __resetReloadArmedForTests();
    // Clean up our navigator.serviceWorker stub between tests so an absent
    // SW container in the next test still reflects the production default.
    // Assign undefined rather than delete — biome flags `delete` as a perf
    // anti-pattern and Object.defineProperty with value:undefined matches
    // jsdom's "absent property" behaviour for `"serviceWorker" in navigator`
    // checks downstream.
    try {
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: undefined,
      });
    } catch {
      // Some jsdom builds make this non-configurable; best-effort.
    }
  });

  it("renders nothing when there is no pending service-worker update", () => {
    render(<UpdateBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("clicking Reload calls updateServiceWorker(true) AND arms its own controllerchange listener", async () => {
    // notes#148 contract: the click must NOT rely solely on workbox's
    // built-in controlling listener — we wire our own controllerchange
    // listener + fallback timeout so a missed event doesn't leave the
    // user stuck. Pin the wiring (window.location.reload is non-configurable
    // in jsdom so we can't observe the actual reload call here; the unit
    // tests on `reloadAfterServiceWorkerUpdate` in pwa.test.ts cover that
    // half of the contract).
    const swContainer = {
      addEventListener: vi.fn(),
    };
    // Stub navigator.serviceWorker so the production code path can attach
    // its listener. The default jsdom navigator has no serviceWorker
    // property at all.
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: swContainer,
    });

    render(<UpdateBanner />);
    act(() => {
      __getPwaTestRig()?.setNeedRefresh(true);
    });
    // Banner now shows; click Reload.
    const reloadBtn = await screen.findByRole("button", { name: /reload/i });
    await act(async () => {
      fireEvent.click(reloadBtn);
      // Let the onReload async handler land.
      await Promise.resolve();
    });

    // (1) The wrapper still calls updateServiceWorker(true) so workbox's
    // own controlling listener is also armed and skipWaiting is messaged.
    expect(__getPwaUpdateCalls()).toEqual([true]);
    // (2) Our own controllerchange listener was attached BEFORE the
    // skipWaiting message went out — so a missed-by-workbox `controlling`
    // event still triggers our reload path.
    expect(swContainer.addEventListener).toHaveBeenCalledWith(
      "controllerchange",
      expect.any(Function),
      expect.objectContaining({ once: true }),
    );
  });
});
