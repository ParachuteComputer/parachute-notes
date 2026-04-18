import { useVaultStore } from "@/lib/vault";
import { Link, Navigate } from "react-router";

export function Home() {
  const activeVault = useVaultStore((s) => s.getActiveVault());

  if (activeVault) {
    return <Navigate to="/notes" replace />;
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-20 text-center">
      <p className="mb-8 font-serif text-xl italic text-fg-muted">
        A lens onto any Parachute Vault.
      </p>
      <h1 className="mb-4 font-serif text-5xl tracking-tight">Lens</h1>
      <p className="mb-10 text-fg-dim tracking-wide">
        Point it at a vault. Sign in. Browse, edit, visualize.
      </p>

      <Link
        to="/add"
        className="inline-block rounded-md bg-accent px-6 py-3 text-sm font-medium text-white hover:bg-accent-hover"
      >
        Connect a vault
      </Link>
    </div>
  );
}
