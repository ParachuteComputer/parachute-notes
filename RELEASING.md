# Releasing

The `parachute-notes` repo is a monorepo with two publishable packages:

- `@openparachute/notes-ui` — the UI bundle (in `packages/notes-ui/`), installed under parachute-app as the canonical first app
- `@openparachute/notes` — the legacy module daemon (in `packages/notes-daemon/`), **deprecated as of rc.2** in favor of installing notes-ui via parachute-app

The workspace root (`@openparachute/notes-monorepo`) is intentionally `private: true` and should NEVER publish.

## Publish workflow

**To publish a specific package:**

```bash
# From repo root
npm publish --workspace @openparachute/notes-ui --tag rc
npm publish --workspace @openparachute/notes --tag rc

# OR cd into the package
cd packages/notes-ui && npm publish --tag rc
cd packages/notes-daemon && npm publish --tag rc
```

The daemon's build copies notes-ui's `dist/` into its own, so publish `notes-ui` BEFORE the daemon if both are going out in the same session and the daemon's `dist/` needs to reflect a fresh notes-ui build.

**Don't run `npm publish` from the repo root without `--workspace`** — npm would try to publish `@openparachute/notes-monorepo` (the workspace root). That's blocked by `private: true` as a safety net.

## RC vs stable

Pre-1.0, every code-touching publish bumps `rc.N`:
- `npm publish --workspace @openparachute/notes-ui --tag rc` ships to `@rc`
- `npm publish --workspace @openparachute/notes-ui --tag latest` promotes to `@latest` (only after Aaron explicitly says ready)

## Verifying

```bash
npm view @openparachute/notes-ui dist-tags --json
npm view @openparachute/notes dist-tags --json
```
