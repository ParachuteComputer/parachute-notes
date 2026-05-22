# Parachute Notes (`@openparachute/notes`)

The default frontend for [Parachute](https://parachute.computer). Browse, edit, and capture in any [Parachute Vault](https://github.com/ParachuteComputer/parachute-vault).

Parachute Notes is a static single-page app that speaks directly to your vault over its HTTP API. Point it at any vault URL, do OAuth, and browse, edit, create, and visualize your notes. No opinion about how you organize your vault — just a clear window onto what's there.

> **Monorepo note.** This package (`@openparachute/notes`) is the module-shaped wrapper hub installs via `parachute install notes`. The SPA source lives in [`../notes-ui`](../notes-ui), which also publishes as `@openparachute/notes-ui` for installation under [parachute-app][app]. Both packages ship the same `dist/`. Source code edits happen in `../notes-ui/src/`; this package's build step (`scripts/build.mjs`) copies notes-ui's `dist/` into its own publish payload.
>
> The migration arc retiring this package in favor of notes-ui-under-parachute-app is documented in [design Section 16][s16]. This is Phase 1 (additive). Phase 2 deprecates the module form; Phase 3 retires it.
>
> [app]: https://github.com/ParachuteComputer/parachute-app
> [s16]: https://github.com/ParachuteComputer/parachute.computer/blob/main/design/2026-05-21-parachute-apps-design.md#16-notes-migration-to-app

## Status

v1 shipped; v0.2 in progress — offline-capable PWA. Public HTTPS exposure + the mobile-PWA install flow are under active polish for broad launch in the next few weeks. Today's smooth path is desktop-browser-on-localhost after `parachute install notes`.

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

From the workspace root (`parachute-notes/`):

```sh
bun install
bun run dev
```

Open the dev URL, paste your vault URL, connect. `bun run dev` dispatches to `notes-ui`'s Vite dev server.

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
# notes-ui builds first into packages/notes-ui/dist/;
# this package's build step copies that into packages/notes-daemon/dist/.
```

The output `dist/` here is what hub serves via `parachute start notes` — host that directory anywhere if you want to bypass hub.

## Development

Vite + React 19 + TypeScript (strict), Tailwind CSS v4, Biome for lint/format, Vitest + Testing Library for tests. All scripts are workspace-rooted; they dispatch to the right sub-package via `bun --filter`.

```sh
bun run dev         # notes-ui dev server (port 1942)
bun run typecheck   # tsc --noEmit across notes-ui's project references
bun run lint        # biome check over notes-ui
bun run lint:fix    # biome check --write
bun run test        # notes-ui vitest suite, then daemon smoke test
bun run build       # notes-ui vite build, then daemon dist-copy step
```

By default the dev server binds to localhost and rejects Host headers it
doesn't recognize. Set `VITE_EXPOSE=true` to bind to all interfaces and accept
any Host — useful when reaching the dev server from another device on your
tailnet:

```sh
VITE_EXPOSE=true bun run dev
```

### Local-link development against hub

Aaron's `parachute` binary resolves `@openparachute/notes` via the bun-linked global. Re-establish the link after the monorepo move:

```sh
cd packages/notes-daemon
bun link
```

Then from any consumer (hub, in particular), `bun link @openparachute/notes` references the local `packages/notes-daemon/` checkout. `parachute start notes` will then serve the locally-built `dist/`.

## License

AGPL-3.0 — same as Parachute Vault.
