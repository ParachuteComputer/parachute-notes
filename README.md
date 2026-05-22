# parachute-notes

Monorepo for Parachute Notes. Two npm publish targets, one shared source.

| Package | Publishes as | Role |
|---|---|---|
| [`packages/notes-ui`](./packages/notes-ui) | `@openparachute/notes-ui` | UI bundle only. Installed under [parachute-app](https://github.com/ParachuteComputer/parachute-app) as the canonical first app. |
| [`packages/notes-daemon`](./packages/notes-daemon) | `@openparachute/notes` | Module-shaped wrapper that hub installs via `parachute install notes`. Ships notes-ui's `dist/` + `.parachute/module.json`. |

The two publish in parallel during the migration arc (see [design Section 16][s16]). Phase 1 (this layout) makes notes-ui available without disrupting the existing module. Phase 2 deprecates the module form. Phase 3 retires it.

[s16]: https://github.com/ParachuteComputer/parachute.computer/blob/main/design/2026-05-21-parachute-apps-design.md#16-notes-migration-to-app

## Working in this repo

```
bun install                # workspace install (bun's --filter is what scripts dispatch through)
bun run dev                # vite dev for notes-ui
bun run build              # builds notes-ui dist/, then copies it into notes-daemon/dist
bun run test               # notes-ui vitest suite (842 tests), then notes-daemon smoke test
bun run typecheck          # notes-ui only — daemon has no TS source
bun run lint               # biome over notes-ui
```

The development guide, mount-path convention, tag-roles primitive, and per-vault settings doc all live in [`packages/notes-daemon/README.md`](./packages/notes-daemon/README.md) — that's where the SPA + module surface is documented end-to-end.

## Release flow

Pre-1.0 governance applies: every code-touching PR bumps the rc chain. Both packages bump in lockstep on a structural-restructure PR like this one; thereafter they bump independently. See [parachute-patterns/patterns/governance.md][gov] for the canonical rules.

[gov]: https://github.com/ParachuteComputer/parachute-patterns/blob/main/patterns/governance.md
