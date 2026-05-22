# @openparachute/notes-ui

The Parachute Notes UI bundle, packaged for installation under [parachute-app][app].

[app]: https://github.com/ParachuteComputer/parachute-app

## What's in the box

`dist/` is the Vite-built SPA. The package ships nothing else of substance — no node entrypoint, no bin, no daemon. The bundle is mount-path-agnostic when built with `VITE_BASE_PATH=/app/notes/` (or any other path under parachute-app's `/app/<name>/` convention).

## Install via parachute-app

```
parachute-app add @openparachute/notes-ui --name notes --path /app/notes
```

parachute-app fetches this package from npm, unpacks `dist/`, and serves it under the declared mount path. OAuth DCR + hub-issued bearers + the standard scopes wiring all flow through parachute-app's bootstrap.

## The other publish target

`@openparachute/notes` (in [`../notes-daemon`](../notes-daemon)) is the legacy module-shaped wrapper hub installs via `parachute install notes`. Both ship the same bundle during the [notes migration arc Section 16][s16]; the module form retires in Phase 3.

[s16]: https://github.com/ParachuteComputer/parachute.computer/blob/main/design/2026-05-21-parachute-apps-design.md#16-notes-migration-to-app

## Source

Notes' source — components, hooks, vault client, sync engine, PWA — lives in `src/`. The development docs (mount-path convention, tag-roles, per-vault settings, transcription) are in the daemon package's [README](../notes-daemon/README.md); they apply unchanged to the UI bundle.
