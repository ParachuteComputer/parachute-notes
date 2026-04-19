import { useRegisterSW } from "virtual:pwa-register/react";

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

  return (
    <output className="fixed inset-x-0 bottom-4 z-40 mx-auto flex max-w-sm items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3 shadow-lg">
      <p className="text-sm text-fg">A new version of Lens is available.</p>
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
          onClick={() => updateServiceWorker(true)}
          className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Reload
        </button>
      </div>
    </output>
  );
}
