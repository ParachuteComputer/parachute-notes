# Parachute Notes

The default frontend for [Parachute](https://parachute.computer). Browse, edit, and capture in any [Parachute Vault](https://github.com/ParachuteComputer/parachute-vault), from any device.

Parachute Notes is a static single-page app that speaks directly to your vault over its HTTP API. Point it at any vault URL, do OAuth, and browse, edit, create, and visualize your notes. No opinion about how you organize your vault — just a good lens onto what's there.

## Status

v1 shipped; v0.2 in progress — offline-capable PWA.

## Install Parachute Notes

Parachute Notes is installable as a Progressive Web App. Once installed, it runs in its own window, launches from your home screen or dock, and (from v0.2 onward) keeps working when you're offline.

- **Desktop Chrome / Edge** — visit your hosted Parachute Notes, click **Install app** in the header, or use the browser's install icon in the address bar.
- **Android Chrome** — tap **Install app**, or use the browser menu → **Install app**.
- **iOS Safari** — tap the Share icon, then **Add to Home Screen**. (Safari doesn't expose a JS install prompt, so Parachute Notes shows a hint with the steps.)

A few iOS quirks worth knowing:

- iOS caps PWA storage at roughly 50 MB per app.
- Apple may evict data from a PWA that hasn't been opened in a while.
- There is no `beforeinstallprompt` event on iOS — the Add to Home Screen flow is manual.

## Quick start

```sh
bun install
bun run dev
```

Open the dev URL, paste your vault URL, connect.

## What it gives you

- Multi-vault support — switch between vaults, tokens stored per vault
- Note list with search, tag and path filters
- Note view with rendered markdown, metadata, resolved `[[wikilinks]]`
- Markdown editor with live preview, attachments (drag, drop, paste)
- Create and delete notes
- Tag index at `/tags` — browse and click through to filtered note lists
- Neighborhood graph on each note (via the vault's `near` query)
- Full-vault graph at `/graph` with search and tag filters
- Theme matched to Parachute's visual language — system, light, or dark; toggle in the header
- Offline-capable mutations (plumbing) — create / update / delete / attachment actions issued offline are queued in IndexedDB (with OPFS for blobs when available) and drained when the vault comes back in reach. Conflicts are stashed for human resolution; auth errors halt the drain until you reconnect. UI for the queue ships in a later PR.

## Build from source

```sh
bun install
bun run build
# static output in dist/ — host anywhere
```

## Development

Vite + React 19 + TypeScript (strict), Tailwind CSS v4, Biome for lint/format, Vitest + Testing Library for tests.

```sh
bun run dev         # dev server
bun run typecheck   # tsc --noEmit across the project references
bun run lint        # biome check
bun run lint:fix    # biome check --write
bun run test        # vitest run
bun run build       # tsc -b && vite build
```

By default the dev server binds to localhost and rejects Host headers it
doesn't recognize. Set `VITE_EXPOSE=true` to bind to all interfaces and accept
any Host — useful when reaching the dev server from another device on your
tailnet:

```sh
VITE_EXPOSE=true bun run dev
```

## License

AGPL-3.0 — same as Parachute Vault.
