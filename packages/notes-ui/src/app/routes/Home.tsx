import { useOriginVaultProbe } from "@/lib/vault";
import { Link } from "react-router";

// No-vault landing. Mounted at `/` only when no vault is connected (the
// dispatch lives in `App.tsx`'s `NotesIndex`), so this component never has
// to redirect anywhere and never has to think about a connected vault.
export function Home() {
  const probe = useOriginVaultProbe();
  const foundOrigin = probe.status === "found" ? probe.origin : null;
  const probing = probe.status === "probing";

  return (
    <div className="mx-auto max-w-2xl px-6 py-20 text-center">
      <p className="mb-8 font-serif text-xl italic text-fg-muted">
        The default frontend for Parachute.
      </p>
      <h1 className="mb-4 font-serif text-5xl tracking-tight">Notes</h1>

      {/* Hold back the CTA while probing so we don't flash "Connect a vault"
          and then swap it for "Looks like there's a vault at ..." once the
          probe resolves. Reserve vertical space so the wordmark doesn't jump. */}
      {probing ? (
        <div className="h-28" aria-hidden="true" />
      ) : foundOrigin ? (
        <>
          <p className="mb-8 text-fg tracking-wide">
            Looks like there's a vault at{" "}
            <code className="rounded bg-bg/60 px-1.5 py-0.5 font-mono text-sm">{foundOrigin}</code>.
          </p>
          <Link
            to={`/add?url=${encodeURIComponent(foundOrigin)}`}
            className="inline-block rounded-md bg-accent px-6 py-3 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Connect
          </Link>
          <div className="mt-4">
            <Link to="/add" className="text-sm text-fg-dim hover:text-accent">
              Or connect to a different vault
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="mb-10 text-fg-dim tracking-wide">
            Point it at a vault. Sign in. Browse, edit, visualize.
          </p>
          <Link
            to="/add"
            className="inline-block rounded-md bg-accent px-6 py-3 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Connect a vault
          </Link>
        </>
      )}
    </div>
  );
}
