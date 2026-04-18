# Parachute Lens

A lightweight web UI for any [Parachute Vault](https://github.com/ParachuteComputer/parachute-vault).

Lens is a static single-page app that speaks directly to your vault over its HTTP API. Point it at any vault URL, do OAuth, and browse, edit, create, and visualize your notes. No opinion about how you organize your vault — just a good lens onto what's there.

## Status

Pre-alpha, in active development toward launch with Parachute Vault.

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
- Markdown editor with live preview
- Create and delete notes
- Neighborhood graph on each note (via the vault's `near` query)
- Full-vault graph view
- Theme matched to Parachute's visual language

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

## License

AGPL-3.0 — same as Parachute Vault.
