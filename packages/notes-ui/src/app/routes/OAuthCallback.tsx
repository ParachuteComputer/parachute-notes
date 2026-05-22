import {
  PendingApprovalError,
  completeOAuth,
  saveServicesCatalog,
  storedFromTokenResponse,
  useVaultStore,
} from "@/lib/vault";
import { useAuthHaltStore } from "@/lib/vault/auth-halt-store";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

type Status =
  | { kind: "working" }
  | { kind: "error"; message: string }
  | { kind: "pending-approval"; approveUrl: string };

export function OAuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const addVault = useVaultStore((s) => s.addVault);
  const [status, setStatus] = useState<Status>({ kind: "working" });
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");

    if (oauthError) {
      setStatus({ kind: "error", message: `Vault returned: ${oauthError}` });
      return;
    }
    if (!code || !state) {
      setStatus({ kind: "error", message: "Missing code or state in callback URL." });
      return;
    }

    (async () => {
      try {
        const { pending, token } = await completeOAuth(code, state);
        // Hub-issued tokens carry a `services` catalog (Phase 1): trust the
        // hub's vault URL over whatever the user pasted, so a hub login works
        // even if the user typed the hub origin. Standalone-vault tokens have
        // no catalog, in which case the issuer URL itself is the vault URL.
        //
        // Multi-vault hubs (post hub#247/#248) also emit a per-vault key
        // `vault:<name>` alongside the legacy collapsed `vault` entry. Prefer
        // the per-vault key when the token's `vault` claim names which one we
        // OAuthed for — otherwise on a hub fronting boulder + gitcoin + techne
        // every connect would resolve to the same first-vault URL and the
        // stored VaultRecords would collide. Pre-#247 hubs (no per-vault keys)
        // fall through to the collapsed entry.
        const perVaultKey = token.vault ? `vault:${token.vault}` : undefined;
        const vaultUrl =
          (perVaultKey ? token.services?.[perVaultKey]?.url : undefined) ??
          token.services?.vault?.url ??
          pending.issuerUrl;
        // app-client's TokenResponse marks `vault` optional (hub responses
        // sometimes omit it on standalone-vault flows that pre-date hub-as-
        // issuer); fall back to the issuer-derived display name so VaultRecord
        // always carries something to render.
        const id = addVault(
          {
            url: vaultUrl,
            name: token.vault ?? pending.issuer,
            issuer: pending.issuer,
            tokenEndpoint: pending.tokenEndpoint,
            clientId: pending.clientId,
            scope: token.scope,
          },
          storedFromTokenResponse(token),
        );
        if (token.services) saveServicesCatalog(id, token.services);
        // Reconnect succeeded — clear the halt so the banner disappears.
        // Clear BOTH the new vault's id AND the originally-halted vault's id
        // when the reconnect path stashed one on the pending state. The two
        // can differ when the hub's token catalog resolves the vault to a
        // different URL than what was stored — addVault then creates a new
        // entry under a fresh id and the halt for the old id would otherwise
        // be orphaned in localStorage and re-surface the next time the user
        // switched back (notes#148).
        const halt = useAuthHaltStore.getState();
        halt.clearHalt(id);
        if (pending.priorHaltedVaultId && pending.priorHaltedVaultId !== id) {
          halt.clearHalt(pending.priorHaltedVaultId);
        }
        navigate("/", { replace: true });
      } catch (err) {
        if (err instanceof PendingApprovalError) {
          setStatus({
            kind: "pending-approval",
            approveUrl: err.approveUrl,
          });
          return;
        }
        setStatus({ kind: "error", message: (err as Error).message });
      }
    })();
  }, [params, navigate, addVault]);

  if (status.kind === "working") {
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="mb-3 font-serif text-3xl">Connecting…</h1>
        <p className="text-fg-muted">Exchanging the authorization code with your vault.</p>
      </div>
    );
  }

  if (status.kind === "pending-approval") {
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="mb-3 font-serif text-3xl">Waiting for hub approval</h1>
        <p className="mb-8 text-fg-muted">
          Your hub admin needs to approve this app before sign-in can complete. Open the approval
          page in your hub, approve, then try again.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href={status.approveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-md bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover"
          >
            Open approval page
          </a>
          <button
            type="button"
            onClick={() => navigate("/add", { replace: true })}
            className="inline-block rounded-md border border-border bg-card px-4 py-2 text-sm text-fg-muted hover:text-accent"
          >
            Retry now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="mb-3 font-serif text-3xl text-red-400">Connection failed</h1>
      <p className="mb-8 text-fg-muted">{status.message}</p>
      <button
        type="button"
        onClick={() => navigate("/add", { replace: true })}
        className="rounded-md bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover"
      >
        Try again
      </button>
    </div>
  );
}
