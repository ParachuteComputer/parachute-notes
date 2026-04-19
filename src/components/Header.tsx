import { InstallPrompt } from "@/components/InstallPrompt";
import { SyncStatusIndicator } from "@/components/SyncStatusIndicator";
import { ThemeToggle } from "@/components/ThemeToggle";
import { type VaultRecord, useVaultStore } from "@/lib/vault";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const vaults = useVaultStore((s) => s.vaults);
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const setActiveVault = useVaultStore((s) => s.setActiveVault);
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu whenever the route changes — otherwise a tap on a
  // nav link would leave the panel open over the destination page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger, not a value used in the body
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

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
    <header
      className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-4 md:py-5">
        <Link to="/" className="font-serif text-xl tracking-tight text-fg hover:text-accent">
          Parachute Notes
        </Link>

        {/* Desktop nav */}
        <div className="hidden items-center gap-3 md:flex">
          {hasVaults ? (
            <>
              <Link to="/notes" className="text-sm text-fg-muted hover:text-accent">
                Notes
              </Link>
              <Link to="/tags" className="text-sm text-fg-muted hover:text-accent">
                Tags
              </Link>
              <Link to="/graph" className="text-sm text-fg-muted hover:text-accent">
                Graph
              </Link>
              <Link to="/capture" className="text-sm text-fg-muted hover:text-accent">
                + Capture
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
              <Link to="/settings" className="text-sm text-fg-muted hover:text-accent">
                Settings
              </Link>
              <SyncStatusIndicator />
              <InstallPrompt />
              <ThemeToggle />
            </>
          ) : (
            <>
              <span className="text-sm text-fg-dim">No vault connected</span>
              <InstallPrompt />
              <ThemeToggle />
            </>
          )}
        </div>

        {/* Mobile cluster: sync status (always visible) + hamburger */}
        <div className="flex items-center gap-2 md:hidden">
          {hasVaults ? <SyncStatusIndicator /> : null}
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card text-fg-muted hover:text-accent"
          >
            <span aria-hidden="true" className="font-mono text-base leading-none">
              {menuOpen ? "✕" : "☰"}
            </span>
          </button>
        </div>
      </nav>

      {menuOpen ? (
        <div id="mobile-menu" className="border-t border-border bg-bg/95 px-6 py-4 md:hidden">
          {hasVaults ? (
            <div className="flex flex-col gap-3">
              <Link to="/notes" className="py-1 text-sm text-fg hover:text-accent">
                Notes
              </Link>
              <Link to="/tags" className="py-1 text-sm text-fg hover:text-accent">
                Tags
              </Link>
              <Link to="/graph" className="py-1 text-sm text-fg hover:text-accent">
                Graph
              </Link>
              <Link to="/capture" className="py-1 text-sm text-fg hover:text-accent">
                + Capture
              </Link>
              <Link to="/settings" className="py-1 text-sm text-fg hover:text-accent">
                Settings
              </Link>
              <button
                type="button"
                onClick={() => navigate("/vaults")}
                className="py-1 text-left text-sm text-fg hover:text-accent"
              >
                Manage vaults
              </button>
              <label className="mt-1 block text-xs text-fg-dim">
                <span className="mb-1 block uppercase tracking-wider">Active vault</span>
                <select
                  value={activeVaultId ?? ""}
                  onChange={(e) => setActiveVault(e.target.value || null)}
                  className="w-full rounded-md border border-border bg-card px-2.5 py-2 text-sm text-fg"
                >
                  {vaultList.map((v) => (
                    <option key={v.id} value={v.id}>
                      {vaultLabel(v)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-1 flex items-center gap-3">
                <InstallPrompt />
                <ThemeToggle />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-fg-dim">No vault connected</p>
              <div className="flex items-center gap-3">
                <InstallPrompt />
                <ThemeToggle />
              </div>
            </div>
          )}
        </div>
      ) : null}
    </header>
  );
}
