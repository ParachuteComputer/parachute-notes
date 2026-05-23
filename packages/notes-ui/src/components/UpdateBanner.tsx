import { useRegisterSW } from "virtual:pwa-register/react";
import { reloadAfterServiceWorkerUpdate } from "@/lib/pwa";
import { shouldRegisterServiceWorker } from "@/lib/sw-bootstrap";

/**
 * Inner banner that actually drives `useRegisterSW`. Split out from the
 * exported `UpdateBanner` shim so the hook only runs when the runtime
 * mount matches the build-time vite base — calling `useRegisterSW` at a
 * mismatched mount would register the SW with the wrong scope (the bug
 * Aaron hit 2026-05-23). React hooks can't be conditional within a single
 * component, but conditional *rendering* of the child component is fine.
 */
function UpdateBannerInner() {
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

/**
 * Mount-gated SW registration. The PWA service worker and manifest are
 * baked at Vite build time with a fixed scope (default `/notes/`); when
 * the bundle is served at a different mount (e.g. `/app/notes/` under
 * parachute-app), registering the SW there interferes with every fetch
 * — workbox can't find precached entries for the runtime mount and ends
 * up returning HTML for what should be JS modules / JSON manifests.
 *
 * We render the inner banner (and let it call `useRegisterSW`) only when
 * the runtime mount matches the build-time base. Otherwise we render
 * nothing — no SW registration, no update banner. The CHANGELOG documents
 * this as a known limitation: PWA install requires a custom build with
 * `VITE_BASE_PATH=<runtime-mount>` for non-default mounts.
 */
export function UpdateBanner() {
  if (!shouldRegisterServiceWorker()) return null;
  return <UpdateBannerInner />;
}
