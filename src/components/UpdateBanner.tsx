import { useRegisterSW } from "virtual:pwa-register/react";
import { reloadAfterServiceWorkerUpdate } from "@/lib/pwa";

export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Check for a fresh SW hourly while the app is open.
      if (!registration) return;
      const hour = 60 * 60 * 1000;
      setInterval(() => {
        registration.update().catch(() => {});
      }, hour);
    },
  });

  if (!needRefresh) return null;

  async function onReload() {
    // Belt-and-suspenders reload: vite-plugin-pwa's built-in `controlling`
    // listener (registered inside `showSkipWaitingPrompt`) is supposed to
    // reload the page after the new SW takes over, but in real PWAs that
    // event can be missed (already-fired-before-listener-attached, iOS
    // standalone quirks, BFCache interactions) and the click visibly does
    // nothing. We arm our own controllerchange listener + a hard timeout
    // BEFORE asking the SW to skipWaiting, so whichever fires first
    // triggers the reload. Whichever path wins, `window.location.reload()`
    // gets called exactly once (notes#148).
    reloadAfterServiceWorkerUpdate();
    await updateServiceWorker(true);
  }

  return (
    <output className="fixed inset-x-0 bottom-4 z-40 mx-auto flex max-w-sm items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3 shadow-lg">
      <p className="text-sm text-fg">A new version of Parachute Notes is available.</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          className="text-sm text-fg-muted hover:text-accent"
        >
          Later
        </button>
        <button
          type="button"
          onClick={onReload}
          className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Reload
        </button>
      </div>
    </output>
  );
}
