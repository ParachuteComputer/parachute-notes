import { isLegacyVaultUrl, useVaultStore } from "@/lib/vault";
import { Link } from "react-router";

export function Vaults() {
  const vaults = useVaultStore((s) => s.vaults);
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const removeVault = useVaultStore((s) => s.removeVault);
  const setActiveVault = useVaultStore((s) => s.setActiveVault);

  const list = Object.values(vaults).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-serif text-4xl tracking-tight">Vaults</h1>
        <Link
          to="/add"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Add vault
        </Link>
      </div>

      {list.length === 0 ? (
        <p className="text-fg-muted">No vaults connected yet.</p>
      ) : (
        <ul className="space-y-3">
          {list.map((vault) => {
            const isActive = vault.id === activeVaultId;
            const isLegacy = isLegacyVaultUrl(vault.url);
            return (
              <li key={vault.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-serif text-lg text-fg">{vault.name}</span>
                      {isActive ? (
                        <span className="rounded bg-accent/10 px-2 py-0.5 text-xs text-accent">
                          active
                        </span>
                      ) : null}
                      <span className="rounded border border-border px-2 py-0.5 text-xs text-fg-dim">
                        {vault.scope}
                      </span>
                      {isLegacy ? (
                        <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-500">
                          needs reconnect
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-fg-muted">{vault.url}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 text-sm">
                    {!isActive ? (
                      <button
                        type="button"
                        onClick={() => setActiveVault(vault.id)}
                        className="text-fg-muted hover:text-accent"
                      >
                        Make active
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Remove ${vault.name}? The access token will be deleted.`)) {
                          removeVault(vault.id);
                        }
                      }}
                      className="text-red-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {isLegacy ? (
                  <p className="mt-3 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-500">
                    Vault now serves under <code>/vault/&lt;name&gt;/</code>. This stored URL is
                    from the older scheme and won't reach the new endpoints. Remove this entry and{" "}
                    <Link to="/add" className="underline">
                      add it again
                    </Link>{" "}
                    — discovery will pick the right URL automatically.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
