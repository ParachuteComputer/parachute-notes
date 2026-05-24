# parachute-notes — ARCHIVED

> **This repo is being archived as of 2026-05-24.** See [DEPRECATED.md](./DEPRECATED.md) for the migration details.

## Where things moved

| Package | Status | New location |
|---|---|---|
| `@openparachute/notes-ui` | active, **moved** | [`parachute-app/packages/notes-ui`](https://github.com/ParachuteComputer/parachute-app/tree/main/packages/notes-ui) |
| `@openparachute/notes` (daemon) | deprecated | [`packages/notes-daemon/DEPRECATED.md`](./packages/notes-daemon/DEPRECATED.md) |

Both packages stay on npm; existing operators on `@openparachute/notes-ui@0.1.3` or `@openparachute/notes@0.3.x` are unaffected. Future releases of notes-ui ship from parachute-app.

## Why the move

Notes is the canonical first app under parachute-app's host-module pattern. After notes-daemon's deprecation arc, notes-ui was going to be the only active package in this repo — and a single-package repo is architecturally awkward when the package is conceptually a "reference app" living under the host module's purview. Consolidating in parachute-app (alongside future reference apps like calendar / tasks / etc.) keeps the layering clean.

See [design Section 16][s16] for the migration arc context.

[s16]: https://github.com/ParachuteComputer/parachute.computer/blob/main/design/2026-05-21-parachute-apps-design.md#16-notes-migration-to-app

## For installs / development

- `bun add @openparachute/notes-ui` works exactly as before — same npm package, same versions
- Source / issues / PRs: https://github.com/ParachuteComputer/parachute-app
- Build / test / dev: see [`parachute-app/RELEASING.md`](https://github.com/ParachuteComputer/parachute-app/blob/main/RELEASING.md) + the workspace conventions in `parachute-app/CLAUDE.md`
