# Releasing

The `parachute-notes` repo is a monorepo. Only **one** package is published from CI:

- `@openparachute/notes-ui` — the UI bundle (in `packages/notes-ui/`), installed under parachute-app as the canonical first app. Ships `meta.json` alongside `dist/` so parachute-app's bootstrap validator accepts the tarball (added rc.5; see [meta-schema][meta-schema]).

The sibling package `@openparachute/notes` (the daemon in `packages/notes-daemon/`) is **deprecated as of 2026-05-22** ([DEPRECATED.md](./packages/notes-daemon/DEPRECATED.md)) and **does not ship from CI**. Notes-as-UI is the future; notes-daemon is being archived in phases per the workspace [CLAUDE.md](https://github.com/ParachuteComputer/ParachuteComputer/blob/main/CLAUDE.md). If a notes-daemon rc must ship for a legacy operator, it is still publishable manually via `cd packages/notes-daemon && npm publish --tag rc`, but the deprecation arc means new shipping discipline (this workflow) does not cover it.

[meta-schema]: https://github.com/ParachuteComputer/parachute-app/blob/main/packages/app-host/src/meta-schema.ts

The workspace root (`@openparachute/notes-monorepo`) is intentionally `private: true` and should NEVER publish.

## Tag-triggered CI

Releases of `@openparachute/notes-ui` are automated via [`.github/workflows/release.yml`](./.github/workflows/release.yml). Pushing a git tag of the right shape triggers CI which:

1. Runs `bun run typecheck` + `bun run test` (in `packages/notes-ui/`).
2. Publishes `@openparachute/notes-ui` to npm with provenance attestation (Trusted Publishing via OIDC — no `NPM_TOKEN`).

### Tag conventions

Per [parachute-patterns governance rule 2](https://github.com/ParachuteComputer/parachute-patterns/blob/main/patterns/governance.md):

| Tag shape | Example | npm `dist-tag` |
|---|---|---|
| `vX.Y.Z-rc.N` | `v0.1.4-rc.1` | `rc` |
| `vX.Y.Z` | `v0.1.4` | `latest` |

The workflow auto-detects rc vs stable from the tag string (`-rc.` substring). The version in `packages/notes-ui/package.json` MUST match the tag (minus the `v` prefix) — CI hard-fails otherwise.

### For an rc bump (each code-touching PR merge)

After your PR merges to `main` with a bumped `rc.N` in `packages/notes-ui/package.json`:

```sh
git fetch && git checkout main && git pull --ff-only
VERSION="v$(node -p "require('./packages/notes-ui/package.json').version")"
git tag "$VERSION"
git push origin "$VERSION"
```

CI takes over from there — watch the run at [Actions](https://github.com/ParachuteComputer/parachute-notes/actions).

### Promoting an rc chain to stable

When the rc chain is ready to release:

1. Open a PR that drops the `-rc.N` suffix from `packages/notes-ui/package.json` (e.g. `0.1.4-rc.3` → `0.1.4`).
2. Reviewer + merge as usual.
3. Tag the merged commit with the bare version: `git tag v0.1.4 && git push origin v0.1.4`.
4. CI publishes with `dist-tag=latest`.

### Doc-only PRs

Per governance, doc-only PRs are EXEMPT from rc.N bumping — they merge without a version bump and get picked up by the next code-touching PR's rc bump (or by the stable promotion, whichever comes first). Don't fragment a release into many patch bumps mid-validation.

If you DO need to ship a doc-only fix outside an active rc chain (i.e. main is on a stable version with no rc.N in flight), bump the next patch (`0.1.3` → `0.1.4`), tag, ship.

## One-time setup (operator)

Before the workflow can publish, this repo needs an **npm Trusted Publisher** rule. Log into npmjs.com → package `@openparachute/notes-ui` → Settings → Trusted Publishers → "Add a new publisher" → choose **GitHub Actions**. Fill:

- Organization: `ParachuteComputer`
- Repository name: `parachute-notes`
- Workflow filename: `release.yml`
- Environment name: (leave blank)

No `NPM_TOKEN` secret needed — the workflow uses OIDC.

## Workspace dependencies must be concrete in the published manifest

If `notes-ui` depends on any sibling-published package (e.g. `@openparachute/app-client` from the parachute-app repo), the dependency in its `package.json` MUST be a concrete semver (e.g. `"^0.1.0-rc.3"`) — NEVER `workspace:*` or `link:...`.

(Side note: `packages/notes-daemon/package.json` carries `"@openparachute/notes-ui": "workspace:*"` as a devDependency. That's intentional and harmless — notes-daemon is NOT published from this CI workflow, so its `workspace:*` reference never reaches an npm tarball. It only matters for in-repo dev where the workspace resolver does the right thing. If notes-daemon ever returns to CI publish, this would need to flip to concrete semver too.)

**Reason**: `npm publish` does NOT rewrite the `workspace:` protocol at publish time. (Bun's `bun publish` does, but CI uses `npm publish` for Trusted Publishing OIDC.) `link:` is a local-dev-only protocol that always serializes as an unresolvable string in a published tarball. Either form leaks into the npm-served manifest and breaks every install:

```
error: Workspace dependency "@openparachute/app-client" not found
```

This bit us on `@openparachute/notes-ui@0.1.0-rc.3` (and `@openparachute/app@0.2.0-rc.3` next door) — both required emergency rc.4 republishes 2026-05-22.

**To bump a sibling dep** (e.g. when app-client publishes a new rc):

1. Update notes-ui's `package.json` to the new concrete version (e.g. `"^0.1.0-rc.4"`).
2. `bun install` to refresh the lockfile.
3. Run typecheck + tests locally.
4. Bump notes-ui's own `rc.N` + CHANGELOG entry referencing the dep bump.
5. Merge, tag, push (CI publishes).

**Local dev still works** with concrete semver — Bun's resolver matches sibling packages by name regardless of the version string, falling back to the registry only when no sibling matches.

**Verify before tagging**:

```bash
cd packages/notes-ui && npm pack --dry-run
# scan the printed manifest's `dependencies` block — every entry must be a
# concrete semver. NO `workspace:` and NO `link:` strings.
#
# Also confirm `meta.json` appears in the file list — parachute-app's
# bootstrap validator rejects tarballs without it.
```

If the dry-run shows `workspace:` or `link:`, fix the package.json before tagging. If `meta.json` is missing, ensure it's listed in the `files` array of `packages/notes-ui/package.json`.

## Verifying a release

```sh
npm view @openparachute/notes-ui@<version> dist.tarball
npm view @openparachute/notes-ui dist-tags
```

The npm tarball page links to the GitHub Actions run that produced it (provenance attestation).

## Rolling back

There's no "unpublish" path for npm (strict 72-hour unpublish policy you should avoid anyway). To roll back, cut a new rc/patch from a known-good commit reverting the bad change, tag, ship.

## Troubleshooting

- **Workflow doesn't trigger**: confirm the tag matches the workflow's `on.push.tags` pattern (`v[0-9]+.[0-9]+.[0-9]+` or `v[0-9]+.[0-9]+.[0-9]+-rc.[0-9]+`).
- **`version mismatch` error in publish-npm**: `packages/notes-ui/package.json` version differs from the tag. Re-tag the correct commit.
- **`npm ERR! 403 You do not have permission to publish`**: Trusted Publisher rule on npm doesn't match this workflow. Verify org/repo/workflow filename are exactly `ParachuteComputer` / `parachute-notes` / `release.yml`. If the workflow file was renamed, the rule needs updating on npm.
- **`npm ERR! 401 Unauthorized` with no OIDC token**: the workflow is missing `permissions: id-token: write` at the job level. Verify the YAML.

## Manual fallback (notes-daemon legacy)

If a notes-daemon (`@openparachute/notes`) publish is genuinely needed during the deprecation window:

```bash
cd packages/notes-daemon && npm publish --tag rc
```

There is no CI path for this; Aaron handles 2FA from his own shell. Notes-daemon is on the path to archival — don't add CI for it.
