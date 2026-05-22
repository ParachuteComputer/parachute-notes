# Changelog — parachute-notes workspace

This is the monorepo-level changelog. Per-package changelogs live at:

- `packages/notes-daemon/CHANGELOG.md` — `@openparachute/notes`
- `packages/notes-ui/CHANGELOG.md` — `@openparachute/notes-ui`

## 2026-05-22 — notes-daemon deprecated (Phase 2)

`@openparachute/notes` (the daemon at `packages/notes-daemon/`) entered the
deprecation phase of the notes-as-app migration arc (design Section 16). The
daemon continues to ship and serve, but operators are directed to migrate to
`parachute-app` + `@openparachute/notes-ui`. Hub PR #316 adds a transparent
`/notes/*` → `/app/notes/*` redirect so existing bookmarks keep working.

See `packages/notes-daemon/DEPRECATED.md` for the migration path and the
full phase timeline (Phase 3 retirement is targeted for ~Q3 2026).

## 2026-05-21 — Phase 1: monorepo restructure + dual-publish

The repo became a bun workspace with two publish targets — the existing
`@openparachute/notes` daemon and a new `@openparachute/notes-ui` UI bundle
shipped for installation under `parachute-app`. No functional changes; both
packages ship byte-identical bundles. See
`packages/notes-daemon/CHANGELOG.md` entry `0.3.17-rc.1` for the full
restructure mechanics.
