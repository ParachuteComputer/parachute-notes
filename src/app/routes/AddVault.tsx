import { beginOAuth, normalizeVaultUrl, useOriginVaultProbe } from "@/lib/vault";
import { InsecureContextError } from "@/lib/vault/pkce";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

export function AddVault() {
  const [searchParams] = useSearchParams();
  const queryUrl = searchParams.get("url") ?? "";
  const [url, setUrl] = useState(queryUrl);
  const [error, setError] = useState<string | null>(null);
  const [insecureContext, setInsecureContext] = useState(false);
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
    setInsecureContext(false);

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
      // Web Crypto isn't available on non-HTTPS / non-localhost origins,
      // so PKCE can't run at all. Render a distinct banner (different
      // colour + structured remediations) instead of the generic
      // "Connection failed" message so the operator understands the
      // browser-secure-context cause and the two fix paths.
      if (err instanceof InsecureContextError) {
        setInsecureContext(true);
      } else {
        setError((err as Error).message);
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="mb-2 font-serif text-4xl tracking-tight">Connect a vault</h1>
      <p className="mb-8 text-fg-muted">
        Paste your Parachute hub URL. You'll be taken to its consent page to authorize Parachute
        Notes.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="vault-url" className="mb-1.5 block text-sm font-medium text-fg">
            Hub URL
          </label>
          <input
            id="vault-url"
            ref={inputRef}
            type="url"
            required
            placeholder="http://localhost:1939"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={submitting}
            className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-fg focus:border-accent focus:outline-none"
          />
          <p className="mt-1.5 text-xs text-fg-dim">
            For a local install the hub lives at <code>http://localhost:1939</code>. A standalone
            vault URL (e.g. <code>https://host/vault/default</code>) also works — Notes will OAuth
            against whichever issuer answers.
          </p>
        </div>

        {insecureContext ? <InsecureContextBanner /> : null}

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

/**
 * Distinct banner for the insecure-context failure mode (Web Crypto
 * unavailable). Amber / warning palette deliberately — visually
 * different from the generic red "Connection failed" error above so
 * the operator can tell at a glance this isn't "your hub is down" but
 * "your browser refuses to OAuth from this URL." The body lists both
 * remediations (use localhost form, or terminate HTTPS at a tunnel /
 * reverse proxy) and shows the exact origin the browser flagged so
 * there's no ambiguity about which URL the user is on.
 *
 * Exported for use by other OAuth-initiating components
 * (`VaultStatusBanner`'s reconnect path, `VaultPopover`'s connect
 * button) so the messaging stays identical wherever PKCE can fail.
 */
export function InsecureContextBanner() {
  // `window.location.origin` is safe in the React render path — Notes
  // is a browser SPA, there's no SSR. Showing it back to the operator
  // verbatim is the whole point: they need to see the exact URL the
  // browser is treating as insecure, not a generic "this page."
  const currentOrigin =
    typeof window !== "undefined" && window.location ? window.location.origin : "(unknown origin)";
  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="insecure-context-banner"
      className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-3 text-sm text-amber-100"
    >
      <p className="mb-2 flex items-center gap-2 font-medium text-amber-100">
        <span aria-hidden>⚠</span>
        Insecure context — OAuth unavailable
      </p>
      <p className="mb-2 text-xs text-amber-100/90">
        Your hub URL must be served over HTTPS or accessed at <code>http://localhost</code>. This
        page is at <code className="font-mono">{currentOrigin}</code>, which the browser treats as
        insecure for Web Crypto. To connect:
      </p>
      <ul className="ml-4 list-disc space-y-1 text-xs text-amber-100/90">
        <li>
          Use <code>http://localhost</code> or <code>http://127.0.0.1</code> directly (replace your
          hub URL with the localhost form), <strong>or</strong>
        </li>
        <li>
          Serve your hub over HTTPS via Tailscale Serve, Cloudflare Tunnel, or a reverse proxy.
        </li>
      </ul>
    </div>
  );
}
