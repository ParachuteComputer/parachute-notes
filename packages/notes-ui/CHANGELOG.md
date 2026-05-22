# Changelog — @openparachute/notes-ui

## [0.1.0-rc.2] - 2026-05-22

- **Adopt `@openparachute/app-client`** (Phase 2 of the notes-migration-
  to-app arc — [parachute-app#6][app6], design doc [Section 16][s16]).
  The in-repo OAuth driver, VaultClient error classes, PKCE primitives,
  discovery + DCR helpers, URL/vault-id helpers, and service-worker
  reload code are now re-exports from `@openparachute/app-client`. Net
  ~750 lines deleted across `packages/notes-ui/src/lib/vault/` and
  `packages/notes-ui/src/lib/pwa.ts`; behaviour unchanged.

  Notes-specific orchestration stays here: `priorHaltedVaultId` round-
  trip (notes#148), `redirectUriForOrigin` (mount-path aware),
  issuer-keyed DCR cache, tag-curation endpoints (`renameTag`,
  `mergeTags`, `deleteTag`, `updateTag`, `listTagsWithSchema`), and
  the multi-vault store + refresh-on-401 pipeline. The VaultClient
  request loop currently still lives here because app-client's
  `request` is `private`; a follow-up will lift it to `protected` so
  Notes can subclass and shrink further.

  Local-dev wiring: notes-ui depends on `@openparachute/app-client` via
  `bun link` until app-client is published to npm. Operators running
  notes-ui from a local checkout should `bun link @openparachute/app-
  client` from the parachute-app workspace first.

[app6]: https://github.com/ParachuteComputer/parachute-app/issues/6

## [0.1.0-rc.1] - 2026-05-21

- **Initial release.** Parachute Notes UI bundle, split out of the
  parachute-notes monorepo as a parallel publish target alongside the
  existing `@openparachute/notes` module package. This is Phase 1 of the
  notes-migration-to-app arc captured in the [parachute apps design
  doc Section 16][s16].

  notes-ui ships only the Vite-built SPA — no daemon, no module surface,
  no `bin`, no `.parachute/module.json`. Operators install it under
  [parachute-app][app] via `parachute-app add @openparachute/notes-ui
  --name notes --path /app/notes`.

  Source remains shared with the legacy `@openparachute/notes` module
  package (sibling under `packages/notes-daemon/`). The daemon package's
  build step copies notes-ui's `dist/` into its own publish payload, so
  both packages ship the exact same bundle.

  Version chain restarts at `0.1.0-rc.1` — this is a new npm package
  with no prior history. The legacy module continues at `0.3.17-rc.1`
  on its own chain.

[s16]: https://github.com/ParachuteComputer/parachute.computer/blob/main/design/2026-05-21-parachute-apps-design.md#16-notes-migration-to-app
[app]: https://github.com/ParachuteComputer/parachute-app
