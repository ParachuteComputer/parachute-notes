/**
 * Distinct banner for the insecure-context failure mode (Web Crypto
 * unavailable). Amber / warning palette deliberately — visually
 * different from the generic red "Connection failed" error so the
 * operator can tell at a glance this isn't "your hub is down" but
 * "your browser refuses to OAuth from this URL." The body lists both
 * remediations (use localhost form, or terminate HTTPS at a tunnel /
 * reverse proxy) and shows the exact origin the browser flagged so
 * there's no ambiguity about which URL the user is on.
 *
 * Used by every OAuth-initiating call site (`AddVault`,
 * `VaultStatusBanner`'s reconnect path, `VaultPopover`'s connect
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
