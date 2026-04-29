import { useAuthHaltStore } from "@/lib/vault/auth-halt-store";
import { beginOAuth } from "@/lib/vault/oauth";
import { useVaultStore } from "@/lib/vault/store";
import { useState } from "react";

// Top-level banner shown when the active vault's session is dead (refresh
// token revoked / rotated past us, or repeated 401s). Non-dismissable on
// purpose — every cached query is failing under it, and the only fix is
// reauth. Click → re-runs the OAuth flow against the original issuer; we
// don't auto-redirect because a silent jump to the hub mid-session would
// lose unsaved input.

export function ReconnectBanner() {
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const vault = useVaultStore((s) => s.getActiveVault());
  const halt = useAuthHaltStore((s) =>
    activeVaultId ? (s.byVault[activeVaultId] ?? null) : null,
  );
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!halt || !vault || !activeVaultId) return null;

  async function onReconnect() {
    if (!vault) return;
    setError(null);
    setReconnecting(true);
    try {
      // Prefer the issuer we OAuthed against originally — under hub-as-issuer
      // that's the hub origin, not the vault URL. Falls back to the vault URL
      // for legacy standalone-vault records.
      const issuer = vault.issuer ?? vault.url;
      const { authorizeUrl } = await beginOAuth(issuer, vault.scope);
      window.location.assign(authorizeUrl);
    } catch (err) {
      setReconnecting(false);
      setError(err instanceof Error ? err.message : String(err));
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
          <p className="text-xs text-red-200/80">{halt.reason}</p>
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
    </div>
  );
}
