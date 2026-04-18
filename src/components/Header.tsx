import { type VaultRecord, useVaultStore } from "@/lib/vault";
import { Link, useNavigate } from "react-router";

export function Header() {
  const navigate = useNavigate();
  const vaults = useVaultStore((s) => s.vaults);
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const setActiveVault = useVaultStore((s) => s.setActiveVault);

  const vaultLabel = (v: VaultRecord): string => {
    if (v.name) return v.name;
    try {
      return new URL(v.url).host;
    } catch {
      return v.url;
    }
  };
  const vaultList = Object.values(vaults).sort((a, b) =>
    vaultLabel(a).localeCompare(vaultLabel(b)),
  );
  const hasVaults = vaultList.length > 0;

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-5">
        <Link to="/" className="font-serif text-xl tracking-tight text-fg hover:text-accent">
          Parachute Lens
        </Link>

        <div className="flex items-center gap-3">
          {hasVaults ? (
            <>
              <Link to="/notes" className="text-sm text-fg-muted hover:text-accent">
                Notes
              </Link>
              <Link to="/graph" className="text-sm text-fg-muted hover:text-accent">
                Graph
              </Link>
              <label htmlFor="vault-switcher" className="sr-only">
                Active vault
              </label>
              <select
                id="vault-switcher"
                value={activeVaultId ?? ""}
                onChange={(e) => setActiveVault(e.target.value || null)}
                className="rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-fg"
              >
                {vaultList.map((v) => (
                  <option key={v.id} value={v.id}>
                    {vaultLabel(v)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => navigate("/vaults")}
                className="text-sm text-fg-muted hover:text-accent"
              >
                Manage
              </button>
            </>
          ) : (
            <span className="text-sm text-fg-dim">No vault connected</span>
          )}
        </div>
      </nav>
    </header>
  );
}
