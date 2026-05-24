# parachute-notes is being archived

> **Migration date: 2026-05-24**

Both packages that this repo used to ship have moved or retired:

## `@openparachute/notes-ui` — moved to parachute-app

[`@openparachute/notes-ui`](https://www.npmjs.com/package/@openparachute/notes-ui) now ships from [`parachute-app/packages/notes-ui`](https://github.com/ParachuteComputer/parachute-app/tree/main/packages/notes-ui). The package on npm is unchanged — same name, same versioning, same Trusted Publishing flow. Only the source repo moved.

Why: consolidating "host module + reference apps" in one repo. parachute-app is the host that auto-bootstraps notes-ui as the canonical first app; keeping them together mirrors what frameworks like Rails / NixOS / Next.js do with reference examples.

For releases: see [`parachute-app/RELEASING.md`](https://github.com/ParachuteComputer/parachute-app/blob/main/RELEASING.md).

## `@openparachute/notes` (the daemon) — deprecated

[`@openparachute/notes`](https://www.npmjs.com/package/@openparachute/notes) (notes-daemon) was deprecated 2026-05-22 per [its DEPRECATED.md](./packages/notes-daemon/DEPRECATED.md). The notes-as-daemon era is over; notes is now installed via parachute-app's auto-bootstrap mechanism. Hub redirects `/notes/*` → `/app/notes/*` for backwards compat.

The package stays on npm at 0.3.x — operators on legacy installs continue to work — but no new releases are planned.

## What about this repo?

This repo will be **archived** once the dust settles on the migration. Until then it sits read-only for historical reference. PRs and issues are closed.

## If you're looking for the latest notes-ui source

- npm: `bun add @openparachute/notes-ui` (no change — same package name on npm)
- source: https://github.com/ParachuteComputer/parachute-app/tree/main/packages/notes-ui
- changelog: https://github.com/ParachuteComputer/parachute-app/blob/main/packages/notes-ui/CHANGELOG.md
