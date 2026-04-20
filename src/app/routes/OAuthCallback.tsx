import { completeOAuth, saveServicesCatalog, useVaultStore, vaultIdFromUrl } from "@/lib/vault";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

type Status = { kind: "working" } | { kind: "error"; message: string };

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
        // even if the user typed the hub origin. Vault-issued tokens (no
        // catalog) keep the pre-hub behavior of using the pending vault URL.
        const vaultUrl = token.services?.vault?.url ?? pending.vaultUrl;
        const id = addVault(
          {
            url: vaultUrl,
            name: token.vault,
            issuer: pending.issuer,
            clientId: pending.clientId,
            scope: token.scope,
          },
          { accessToken: token.access_token, scope: token.scope, vault: token.vault },
        );
        if (token.services) saveServicesCatalog(id, token.services);
        navigate("/", { replace: true });
      } catch (err) {
        setStatus({ kind: "error", message: (err as Error).message });
      }
    })();
  }, [params, navigate, addVault]);

  // Prevent Biome warning; vaultIdFromUrl is used elsewhere but re-exported via store.
  void vaultIdFromUrl;

  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      {status.kind === "working" ? (
        <>
          <h1 className="mb-3 font-serif text-3xl">Connecting…</h1>
          <p className="text-fg-muted">Exchanging the authorization code with your vault.</p>
        </>
      ) : (
        <>
          <h1 className="mb-3 font-serif text-3xl text-red-400">Connection failed</h1>
          <p className="mb-8 text-fg-muted">{status.message}</p>
          <button
            type="button"
            onClick={() => navigate("/add", { replace: true })}
            className="rounded-md bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover"
          >
            Try again
          </button>
        </>
      )}
    </div>
  );
}
