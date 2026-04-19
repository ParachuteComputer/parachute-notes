import { beginOAuth, normalizeVaultUrl, useOriginVaultProbe } from "@/lib/vault";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

export function AddVault() {
  const [searchParams] = useSearchParams();
  const queryUrl = searchParams.get("url") ?? "";
  const [url, setUrl] = useState(queryUrl);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const prefilled = useRef(queryUrl.length > 0);
  const probe = useOriginVaultProbe();

  // Auto-focus so the user can submit with Enter when the URL is pre-filled
  // via ?url=... or the origin probe. Runs once on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // If the probe resolves with a detected origin and the user hasn't typed
  // anything, seed the input. Don't clobber a ?url= value or user input.
  useEffect(() => {
    if (prefilled.current) return;
    if (probe.status === "found" && probe.origin && url === "") {
      setUrl(probe.origin);
      prefilled.current = true;
    }
  }, [probe.status, probe.origin, url]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    let normalized: string;
    try {
      normalized = normalizeVaultUrl(url);
    } catch (err) {
      setError((err as Error).message);
      return;
    }

    setSubmitting(true);
    try {
      const { authorizeUrl } = await beginOAuth(normalized);
      window.location.assign(authorizeUrl);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="mb-2 font-serif text-4xl tracking-tight">Connect a vault</h1>
      <p className="mb-8 text-fg-muted">
        Paste the URL of a Parachute Vault. You'll be taken to its consent page to authorize
        Parachute Notes.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="vault-url" className="mb-1.5 block text-sm font-medium text-fg">
            Vault URL
          </label>
          <input
            id="vault-url"
            ref={inputRef}
            type="url"
            required
            placeholder="http://localhost:1940"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={submitting}
            className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-fg focus:border-accent focus:outline-none"
          />
          <p className="mt-1.5 text-xs text-fg-dim">
            For multi-vault servers, include the vault path (e.g. <code>/vaults/work</code>).
          </p>
        </div>

        {error ? (
          <div className="rounded-md border border-red-400/30 bg-red-400/5 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting || !url}
          className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Starting OAuth…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
