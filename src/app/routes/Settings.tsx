import { isStandalone } from "@/lib/pwa";
import { type ScribeSettings, scribeHealth, useScribeSettings } from "@/lib/scribe";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault";
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router";

// Per-vault settings UI. v0.2 only surfaces scribe because it's the first
// third-party integration; structured so additional sections slot in without
// re-framing the page.
export function Settings() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  if (!activeVault) return <Navigate to="/" replace />;

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-8">
        <nav className="mb-3 text-sm text-fg-dim">
          <Link to="/" className="hover:text-accent">
            ← Home
          </Link>
        </nav>
        <h1 className="font-serif text-3xl tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Configuring <span className="text-fg">{activeVault.name}</span>.
        </p>
      </header>

      <ScribeSettingsSection vaultId={activeVault.id} />
      <InstallStateSection />
    </div>
  );
}

function InstallStateSection() {
  // matchMedia is only reliable at render time on some browsers, so sample
  // once on mount.
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    setInstalled(isStandalone());
  }, []);
  if (!installed) return null;
  return (
    <section className="mt-6 rounded-md border border-border bg-card p-4 text-sm">
      <p className="text-fg-muted">
        <span className="mr-2 inline-block rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-300">
          Installed
        </span>
        Parachute Lens is running as an installed app on this device.
      </p>
    </section>
  );
}

function ScribeSettingsSection({ vaultId }: { vaultId: string }) {
  const { settings, setSettings } = useScribeSettings(vaultId);
  const pushToast = useToastStore((s) => s.push);

  const [url, setUrl] = useState<string>(settings?.url ?? "");
  const [token, setToken] = useState<string>(settings?.token ?? "");
  const [cleanup, setCleanup] = useState<boolean>(settings?.cleanup === true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

  const configured = settings !== null;

  const save = () => {
    const trimmed = url.trim();
    if (!trimmed) {
      pushToast("Scribe URL is required.", "error");
      return;
    }
    const next: ScribeSettings = {
      url: trimmed,
      token: token.trim() || undefined,
      cleanup,
    };
    setSettings(next);
    pushToast("Scribe settings saved.", "success");
  };

  const clear = () => {
    if (!configured) return;
    if (!confirm("Remove scribe configuration for this vault? Transcription will stop running."))
      return;
    setSettings(null);
    setUrl("");
    setToken("");
    setCleanup(false);
    setTestResult(null);
    pushToast("Scribe settings cleared.", "success");
  };

  const testConnection = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      pushToast("Enter a scribe URL first.", "error");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const ok = await scribeHealth(trimmed, { token: token.trim() || undefined });
      setTestResult(ok ? "ok" : "fail");
    } catch {
      setTestResult("fail");
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-6">
      <div>
        <h2 className="font-serif text-xl text-fg">Transcription (scribe)</h2>
        <p className="mt-1 text-xs text-fg-dim">
          Point to a running{" "}
          <a
            href="https://github.com/ParachuteComputer/parachute-scribe"
            className="underline hover:text-accent"
          >
            parachute-scribe
          </a>{" "}
          instance and new voice memos will transcribe automatically. Leave blank to keep
          transcription disabled.
        </p>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-fg-muted">Scribe URL</span>
        <input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setTestResult(null);
          }}
          placeholder="http://localhost:3200"
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block text-fg-muted">
          Bearer token <span className="text-fg-dim">(optional)</span>
        </span>
        <input
          type="password"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setTestResult(null);
          }}
          placeholder="Required if your scribe is gated behind a proxy"
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-fg-muted">
        <input
          type="checkbox"
          checked={cleanup}
          onChange={(e) => setCleanup(e.target.checked)}
          className="accent-accent"
        />
        <span>Clean up transcripts (LLM pass to fix filler words and punctuation)</span>
      </label>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          type="button"
          onClick={save}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Save
        </button>
        <button
          type="button"
          onClick={testConnection}
          disabled={testing}
          className="rounded-md border border-border bg-bg px-4 py-2 text-sm text-fg-muted hover:text-accent disabled:opacity-50"
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
        {configured ? (
          <button type="button" onClick={clear} className="text-sm text-red-400 hover:text-red-300">
            Clear
          </button>
        ) : null}
        {testResult === "ok" ? (
          <span className="text-sm text-emerald-400">Scribe is reachable.</span>
        ) : null}
        {testResult === "fail" ? (
          <span className="text-sm text-red-400">Couldn't reach scribe at that URL.</span>
        ) : null}
      </div>

      <p className="rounded-md bg-bg/60 p-3 text-xs text-fg-dim">
        Heads up: parachute-scribe doesn't send CORS headers by default. If the test fails with a
        CORS error in the browser console, run scribe behind a reverse proxy that shares your
        vault's origin.
      </p>
    </section>
  );
}
