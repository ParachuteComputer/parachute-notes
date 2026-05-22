# parachute-notes daemon — DEPRECATED

**Status**: Deprecated as of 2026-05-22 — see migration below.

The `@openparachute/notes` daemon is deprecated. Notes now ships as a UI bundle (`@openparachute/notes-ui`) consumed by [parachute-app](https://github.com/ParachuteComputer/parachute-app).

## Migration

If you have notes-daemon installed today:

1. Install parachute-app: `parachute install app`
2. Apps auto-bootstraps Notes on fresh installs; if you have an existing apps install, add it manually:
   `parachute-app add @openparachute/notes-ui --name notes --path /app/notes`
3. Your existing bookmarks/links to `/notes/*` continue working — hub redirects to `/app/notes/*` automatically (Phase 2 redirect window)
4. Optional: uninstall the old daemon: `parachute uninstall notes` (keeps your vault notes intact — they live in vault, not the daemon)

## Why the change

- Notes is conceptually an "app" that consumes a vault — not its own backend service
- parachute-app is the host module for custom UIs (Gitcoin Brain, Unforced Brain, etc.); Notes joins them as the first canonical app
- Reduces ecosystem surface (4 committed-core modules → 3 + 1 host module)
- New UIs can ship as bundles without each becoming a full npm-published module

Full migration arc: https://parachute.computer/design/2026-05-21-parachute-apps-design — Section 16.

## Timeline

- **Phase 1** (done): @openparachute/notes-ui published. notes-daemon continues alongside.
- **Phase 2** (this release): notes-daemon deprecated. Hub redirects /notes/* → /app/notes/*. Operators can migrate at their own pace.
- **Phase 3** (TBD, ~Q3 2026): notes-daemon retires. Port 1942 reclaimed.
- **Phase 4** (cleanup): notes-daemon package archived. Source moves to UI-only.

## Questions / Issues

File at https://github.com/ParachuteComputer/parachute-notes/issues
