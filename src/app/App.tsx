export function App() {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="border-b border-border bg-bg/90 backdrop-blur sticky top-0 z-10">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <a href="/" className="font-serif text-xl tracking-tight text-fg hover:text-accent">
            Parachute Lens
          </a>
          <span className="text-sm text-fg-muted">pre-alpha</span>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-20">
        <section className="text-center">
          <p className="mb-10 font-serif text-xl italic text-fg-muted">
            A lens onto any Parachute Vault.
          </p>
          <h1 className="mb-4 font-serif text-5xl leading-tight tracking-tight sm:text-6xl">
            Lens
          </h1>
          <p className="mb-12 text-fg-dim tracking-wide">
            Point it at a vault. Sign in. Browse, edit, visualize.
          </p>

          <div className="rounded-xl border border-border bg-card p-10 text-left shadow-sm">
            <h2 className="mb-3 font-serif text-xl text-fg">Not connected yet</h2>
            <p className="text-fg-muted">
              Vault URL entry and OAuth 2.1 + PKCE sign-in land in the next PR. This page is the
              scaffold — the foundations are in place for the client, router, and theme.
            </p>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-6 py-10 text-center text-sm text-fg-dim">
        <p>
          Part of the{" "}
          <a href="https://parachute.computer" className="text-accent hover:underline">
            Parachute Computer
          </a>{" "}
          ecosystem. AGPL-3.0.
        </p>
      </footer>
    </div>
  );
}
