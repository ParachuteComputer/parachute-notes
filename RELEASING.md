# Releasing

The `parachute-notes` repo is a monorepo with two publishable packages:

- `@openparachute/notes-ui` — the UI bundle (in `packages/notes-ui/`), installed under parachute-app as the canonical first app. Ships `meta.json` alongside `dist/` so parachute-app's bootstrap validator accepts the tarball (added rc.5; see [meta-schema][meta-schema]).
- `@openparachute/notes` — the legacy module daemon (in `packages/notes-daemon/`), **deprecated as of rc.2** in favor of installing notes-ui via parachute-app

[meta-schema]: https://github.com/ParachuteComputer/parachute-app/blob/main/packages/app-host/src/meta-schema.ts

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

## Workspace dependencies must be concrete in the published manifest

If a publishable package (notes-ui, notes-daemon) depends on a sibling workspace package or any sibling-published package (e.g. `@openparachute/app-client` from the parachute-app repo), the dependency in its `package.json` MUST be a concrete semver (e.g. `"^0.1.0-rc.3"`) — NEVER `workspace:*` or `link:...`.

**Reason**: `npm publish` does NOT rewrite the `workspace:` protocol at publish time. (Bun's `bun publish` does, but we can't bind the publish workflow to a single tool.) `link:` is a local-dev-only protocol that always serializes as an unresolvable string in a published tarball. Either form leaks into the npm-served manifest and breaks every install:

```
error: Workspace dependency "@openparachute/app-client" not found
```

This bit us on `@openparachute/notes-ui@0.1.0-rc.3` (and `@openparachute/app@0.2.0-rc.3` next door) — both required emergency rc.4 republishes 2026-05-22.

**To bump a sibling dep** (e.g. when app-client publishes a new rc):

1. Update the consumer's `package.json` to the new concrete version (e.g. `"^0.1.0-rc.4"`).
2. `bun install` to refresh the lockfile.
3. Run typecheck + tests locally.
4. Bump the consumer's own version + CHANGELOG entry referencing the dep bump.
5. Publish the consumer.

**Local dev still works** with concrete semver — Bun's resolver matches sibling packages by name regardless of the version string, falling back to the registry only when no sibling matches.

**Verify before publishing**:

```bash
cd packages/notes-ui && npm pack --dry-run
# scan the printed manifest's `dependencies` block — every entry must be a
# concrete semver. NO `workspace:` and NO `link:` strings.
#
# Also confirm `meta.json` appears in the file list — parachute-app's
# bootstrap validator rejects tarballs without it.
```

If the dry-run shows `workspace:` or `link:`, fix the package.json before publishing. If `meta.json` is missing, ensure it's listed in the `files` array of `packages/notes-ui/package.json`.

## RC vs stable

Pre-1.0, every code-touching publish bumps `rc.N`:
- `npm publish --workspace @openparachute/notes-ui --tag rc` ships to `@rc`
- `npm publish --workspace @openparachute/notes-ui --tag latest` promotes to `@latest` (only after Aaron explicitly says ready)

## Verifying

```bash
npm view @openparachute/notes-ui dist-tags --json
npm view @openparachute/notes dist-tags --json
```
