import { InsecureContextBanner } from "@/components/InsecureContextBanner";
import { useAuthHaltStore } from "@/lib/vault/auth-halt-store";
import { beginOAuth } from "@/lib/vault/oauth";
import { InsecureContextError } from "@/lib/vault/pkce";
import { useActiveVaultClient } from "@/lib/vault/queries";
import { useVaultReachabilityStore } from "@/lib/vault/reachability-store";
import { useVaultStore } from "@/lib/vault/store";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

// Top-level banner that surfaces the worst current failure for the active
// vault. Two failure modes:
//
//   - **auth-halt** (refresh-token revoked / rotated past us / repeated 401):
//     non-dismissable; recovery = re-run OAuth.
//   - **unreachable** (5xx / network failure → reachability store crossed the
//     `down` threshold): recovery = retry-now button + the probe hook's
//     own backoff schedule in the background.
//
// Auth-halt wins precedence — every query under it is failing on the same
// axis as the OAuth fix, so showing the network banner over it would point
// the user at the wrong recovery. Renamed from `ReconnectBanner` when the
// unreachable axis landed (notes#113) — one banner covers both axes so we
// never stack two red bars at the top of the app.

export function VaultStatusBanner() {
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const vault = useVaultStore((s) => s.getActiveVault());
  const halt = useAuthHaltStore((s) => (activeVaultId ? (s.byVault[activeVaultId] ?? null) : null));
  const reach = useVaultReachabilityStore((s) =>
    activeVaultId ? (s.byVault[activeVaultId] ?? null) : null,
  );

  if (!vault || !activeVaultId) return null;
  if (halt)
    return (
      <AuthHaltBanner
        reason={halt.reason}
        vaultIssuer={vault.issuer ?? vault.url}
        vaultScope={vault.scope}
        vaultId={activeVaultId}
      />
    );
  if (reach && reach.state === "down")
    return <UnreachableBanner vaultUrl={vault.url} vaultId={activeVaultId} />;
  return null;
}

function AuthHaltBanner({
  reason,
  vaultIssuer,
  vaultScope,
  vaultId,
}: { reason: string; vaultIssuer: string; vaultScope: string; vaultId: string }) {
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insecureContext, setInsecureContext] = useState(false);

  async function onReconnect() {
    setError(null);
    setInsecureContext(false);
    setReconnecting(true);
    try {
      // Prefer the issuer we OAuthed against originally — under hub-as-issuer
      // that's the hub origin, not the vault URL. Falls back to the vault URL
      // for legacy standalone-vault records.
      //
      // Pass `priorHaltedVaultId` so OAuthCallback can clear THIS vault's halt
      // on success — required because the token catalog may resolve the vault
      // to a different URL than what's currently stored, in which case
      // addVault creates a NEW vault entry with a different id and the halt
      // for the old id would otherwise be orphaned in localStorage (notes#148).
      const { authorizeUrl } = await beginOAuth(vaultIssuer, vaultScope, undefined, {
        priorHaltedVaultId: vaultId,
      });
      window.location.assign(authorizeUrl);
    } catch (err) {
      // Insecure-context surfaces with a structured remediation banner
      // instead of being squashed into the red one-liner — same reasoning
      // as AddVault / VaultPopover.
      if (err instanceof InsecureContextError) {
        setInsecureContext(true);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      // Reset even on success: if the browser blocks the navigation (popup
      // blocker on a programmatic assign, content-security policy), the page
      // doesn't unload and the button would otherwise stick at "Starting…".
      setReconnecting(false);
    }
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="border-b border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 md:px-6"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-medium text-red-100">Vault session expired</p>
          <p className="text-xs text-red-200/80">{reason}</p>
          {error ? <p className="mt-1 text-xs text-red-300">{error}</p> : null}
        </div>
        <button
          type="button"
          onClick={onReconnect}
          disabled={reconnecting}
          className="self-start rounded-md bg-red-500/30 px-3 py-1.5 text-xs font-medium text-red-50 hover:bg-red-500/50 disabled:cursor-not-allowed disabled:opacity-60 md:self-auto"
        >
          {reconnecting ? "Starting OAuth…" : "Reconnect to vault"}
        </button>
      </div>
      {insecureContext ? (
        <div className="mx-auto mt-2 max-w-5xl">
          <InsecureContextBanner />
        </div>
      ) : null}
    </div>
  );
}

function UnreachableBanner({ vaultUrl, vaultId }: { vaultUrl: string; vaultId: string }) {
  const client = useActiveVaultClient();
  const qc = useQueryClient();
  const resetToHealthy = useVaultReachabilityStore((s) => s.resetToHealthy);
  const [retrying, setRetrying] = useState(false);

  async function onRetry() {
    if (!client) return;
    setRetrying(true);
    try {
      // Force a probe right now instead of waiting for the backoff timer.
      // On success, the client's own onReachability flush resets the store;
      // we also invalidate queries so the UI repaints with fresh data.
      await client.vaultInfo(false);
      qc.invalidateQueries({ queryKey: ["notes", vaultId] });
      qc.invalidateQueries({ queryKey: ["tags", vaultId] });
      qc.invalidateQueries({ queryKey: ["vaultInfo", vaultId] });
      qc.invalidateQueries({ queryKey: ["note", vaultId] });
    } catch {
      // Failure path is already captured by the client's onReachability —
      // the store extends the backoff and re-renders. Nothing to do here.
    } finally {
      setRetrying(false);
    }
  }

  // Local-vault operator hint — only useful when the vault URL points at the
  // user's own machine. For remote/Tailscale URLs we'd be pointing at the
  // wrong host; better to say nothing than mislead. Includes `.local` for
  // mDNS hostnames since Parachute Cloud's per-device URLs use that suffix.
  const hint = isLoopbackOrLocal(vaultUrl) ? "Try `parachute start vault` in a terminal." : null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="border-b border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-200 md:px-6"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-medium text-red-100">Vault not reachable</p>
          <p className="text-xs text-red-200/80">
            Notes can't sync until it's back online.{hint ? ` ${hint}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying || !client}
            className="self-start rounded-md bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-50 hover:bg-red-500/40 disabled:cursor-not-allowed disabled:opacity-60 md:self-auto"
          >
            {retrying ? "Retrying…" : "Retry now"}
          </button>
          <button
            type="button"
            onClick={() => resetToHealthy(vaultId)}
            className="self-start rounded-md px-3 py-1.5 text-xs text-red-200/80 hover:text-red-100 md:self-auto"
            aria-label="Dismiss banner"
            title="Dismiss"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

// RFC 1918 private IPv4 ranges. A vault running on a home LAN at e.g.
// `192.168.1.10:1940` is just as "local" as one on `127.0.0.1` from the
// operator's perspective — same recovery (start the daemon on their box) —
// so the banner hint applies. Loopback `127.0.0.0/8` is matched by the
// explicit `127.0.0.1` check above to keep the regex narrow.
const RFC_1918_IPV4 = /^(10|192\.168|172\.(1[6-9]|2\d|3[0-1]))\./;

export function isLoopbackOrLocal(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    // The URL spec includes `[`/`]` around IPv6 hostnames in `u.hostname` on
    // some engines and strips them on others; normalise to compare.
    const host = u.hostname.replace(/^\[/, "").replace(/\]$/, "");
    if (host === "localhost") return true;
    if (host === "127.0.0.1") return true;
    if (host === "::1") return true;
    if (host.endsWith(".local")) return true;
    if (RFC_1918_IPV4.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}
