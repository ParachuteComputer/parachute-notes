import { type BeforeInstallPromptEvent, isIOS, isStandalone } from "@/lib/pwa";
import { useEffect, useState } from "react";

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [iosDevice, setIosDevice] = useState(false);
  const [iosHintOpen, setIosHintOpen] = useState(false);

  useEffect(() => {
    setStandalone(isStandalone());
    setIosDevice(isIOS());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (standalone) return null;

  const handleInstall = async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") setDeferred(null);
      return;
    }
    if (iosDevice) setIosHintOpen(true);
  };

  const showButton = deferred !== null || iosDevice;
  if (!showButton) return null;

  return (
    <>
      <button
        type="button"
        onClick={handleInstall}
        className="min-h-11 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-fg-muted hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
      >
        Install app
      </button>
      {iosHintOpen ? (
        <dialog
          open
          aria-labelledby="ios-install-title"
          className="fixed inset-0 z-50 m-auto max-w-sm rounded-md border border-border bg-card p-6 text-fg shadow-lg backdrop:bg-black/40"
        >
          <h2 id="ios-install-title" className="mb-3 font-serif text-xl">
            Add Parachute Lens to your home screen
          </h2>
          <ol className="mb-5 list-decimal space-y-2 pl-5 text-sm text-fg-muted">
            <li>Tap the Share icon in Safari's toolbar.</li>
            <li>
              Choose <strong className="text-fg">Add to Home Screen</strong>.
            </li>
            <li>Tap Add. Parachute Lens will open standalone from your home screen.</li>
          </ol>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setIosHintOpen(false)}
              className="min-h-11 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Got it
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
