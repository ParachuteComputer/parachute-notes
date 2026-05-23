# Changelog — @openparachute/notes-ui

## [0.1.3] - 2026-05-23

### Changed
- `detectMountBase()`'s canonical (meta-tag) path now delegates to
  `@openparachute/app-client`'s `getMountBase()` instead of parsing the
  meta tag locally. The thin wrapper preserves the legacy `/notes`
  fallback and keeps the existing `(pathname?, doc?)` signature so
  existing callers' shapes are unchanged. The local regex fallback
  stays in place for pathname-passing callers (`sw-bootstrap.ts`) —
  app-client's helper intentionally does not read
  `window.location.pathname`, so pathname-based detection remains a
  notes-ui concern until every host injects the meta tag (tracked at
  parachute-app#21, partially shipped in app#25). Closes notes#163.

### Fixed
- Removed unreachable `|| undefined` branch in `App.tsx`'s
  `<BrowserRouter basename>`. `detectMountBase()` always returns a
  non-empty string, so the fallback was dead (notes#162 nit).
- Strengthened the SSR/no-window test in `base-url.test.ts` from
  `.toBeDefined()` to `.toBe("/notes")` so the assertion actually
  proves the legacy fallback shape (notes#162 nit).

### Dependencies
- Bumps `@openparachute/app-client` from `^0.1.0-rc.3` to
  `^0.1.0-rc.4`. app-client rc.4 added the runtime tenancy helpers
  (`getMountBase`, `getTenantId`, `getHubOrigin`, `getVaultUrl`) this
  release consumes (parachute-app#27).

## [0.1.2] - 2026-05-23

### Fixed
- Service-worker registration now gates on the runtime mount matching
  the build-time vite base. Resolves the OAuth-callback breakage and
  MIME errors that hit operators running notes-ui under parachute-app
  at the canonical `/app/notes/` mount. The previous build auto-
  registered the SW unconditionally at the page's current scope; the
  precache table was built for `/notes/` so workbox served HTML for
  what should have been JS modules and JSON manifests:

  ```
  Uncaught (in promise) non-precached-url: non-precached-url ::
      [{"url":"/notes/index.html"}]
  Failed to load module script: Expected JavaScript-or-Wasm module,
      got "text/html"
  Manifest: Line: 1, column: 1, Syntax error.
  ```

  The fix:
    - New `src/lib/sw-bootstrap.ts` exports `shouldRegisterServiceWorker()`
      and `cleanupStaleServiceWorker()`. The gate compares the
      build-time vite base (`import.meta.env.BASE_URL` / `VITE_BASE_PATH`)
      against `detectMountBase()` and only registers when they match.
    - `UpdateBanner` splits the `useRegisterSW` call into an inner
      component that only renders when the gate is open — React hooks
      can't be conditional within a single component, but conditional
      *rendering* is fine.
    - `main.tsx` fires `cleanupStaleServiceWorker()` on boot to
      unregister any `/notes/`-scoped SW left over from a pre-0.1.2
      install when the bundle is now being served at a different mount.
      Operators auto-recover on first page load — no DevTools manual
      cleanup needed.
    - `vite.config.ts` declares `injectRegister: false` explicitly,
      documenting that app code is the only registration path (defensive
      — vite-plugin-pwa v1's default already skips auto-inject when
      `useRegisterSW` is used, but the explicit declaration makes the
      contract grep-able).
- `meta.json`'s `version` field synced to the package version (was
  stuck at `0.1.0` through 0.1.1). Cosmetic — `meta.json`'s `version`
  is informational; parachute-app reads `package.json` for install
  resolution — but worth keeping accurate.

### Known limitations
- PWA "Add to Home Screen" install still requires a custom build with
  `VITE_BASE_PATH=/app/<name>` when running under parachute-app at a
  non-default mount. The default bundle targets the daemon-era
  `/notes/` scope for back-compat; in-browser use works at any mount
  from the default bundle (just no installable PWA). A future
  parachute-app manifest-rewrite hook will lift this — tracked
  separately (see 0.1.1 entry below for the original limitation note).

## [0.1.1] - 2026-05-23

- **Fix: runtime mount detection — same built bundle works at any
  mount path.** The 0.1.0 bundle baked `/notes/` into asset URLs and
  the React Router basename at Vite build time, so parachute-app
  installs (which mount UIs at `/app/<slug>/`) loaded the bundle but
  immediately broke:

  ```
  <Router basename="/notes"> is not able to match the URL "/app/notes"
  because it does not start with the basename
  ```

  OAuth also 401'd because the DCR client registered with the wrong
  redirect URI (`/notes/oauth/callback` instead of the live
  `/app/notes/oauth/callback`).

  The fix:
    - Vite `base: ""` emits **relative** asset URLs (`./assets/...`,
      `./manifest.webmanifest`) in the built `index.html`. Browser
      resolves them against the document URL, so assets load from any
      mount.
    - New `src/lib/base-url.ts` exports `detectMountBase()` — reads
      `window.location.pathname` at runtime to identify the mount
      prefix. Recognises `/app/<slug>` (parachute-app's
      single-segment slug grammar, matching `meta-schema`'s
      PATH_PATTERN) and `/notes` (legacy notes-daemon mount), and
      falls back to `/notes` for unrecognised paths.
    - `BrowserRouter`'s `basename` and `oauth.basePathPrefix()` both
      switch from `import.meta.env.BASE_URL` to `detectMountBase()`,
      so router matching and the OAuth callback URL track the live
      mount automatically.

  Same `dist/` now works at `/notes/` (legacy daemon), `/app/notes/`
  (parachute-app default), `/app/<custom-slug>/` (renamed install),
  and any deep route under each.

- **Amendment: meta-tag fast-path before regex fallback.** Adds meta-tag
  fast-path to mount detection. Apps read `<meta name="parachute-mount">`
  first; regex fallback handles the interim until parachute-app injects
  the meta tag (tracked at parachute-app#21). Forward-compatible: when the canonical
  injection ships, no code change required in notes-ui.

- **PWA install limitation (known, deferred to Phase 2).** The PWA
  manifest's `start_url`/`scope` and the service worker's
  `navigateFallback` are fixed at Vite build time — the spec doesn't
  support runtime values without server-side rewriting. The default
  build keeps `/notes/` as the PWA mount; operators who install
  Notes at a non-default mount and want PWA "Add to Home Screen" to
  open the right path must build with `VITE_BASE_PATH=/app/<slug>`.
  In-browser use (no PWA install) works at any mount from a single
  build. A future parachute-app manifest-rewrite hook would lift
  this — tracked separately.

## [0.1.0] - 2026-05-23

- **First stable release; promoted from rc.5.** Tagged `@latest` for
  parachute-app bootstrap's bare-spec resolution.
- **Fix: ship `meta.json` so parachute-app bootstrap can install.**
  parachute-app's auto-bootstrap path validates `@openparachute/notes-
  ui`'s tarball against its [meta-schema][meta-schema] and requires
  `name` + `displayName` + `path`. Tarballs through rc.4 included only
  `dist/`, `LICENSE`, `README.md`, `package.json`, and `CHANGELOG.md`
  — no `meta.json`, so bootstrap failed with:

  ```
  [app] bootstrap: failed to install @openparachute/notes-ui: meta.json:
  name: is required (string); displayName: is required (non-empty
  string); path: is required (string)
  ```

  This release adds `packages/notes-ui/meta.json` and includes it in
  the `files` list. The file declares `name: "notes"`, `displayName:
  "Notes"`, `path: "/app/notes"`, `scopes_required: ["vault:*:read",
  "vault:*:write"]` (vault-agnostic — Notes' in-app vault picker
  narrows per OAuth flow), `pwa: true` + `pwa_service_worker: "sw.js"`
  (Notes is the canonical PWA-mode example per [design §18][s18]),
  `iconUrl: "icon.svg"`, and the `required_schema.tags` declaration
  for `capture` / `capture/text` / `capture/voice` mirroring
  `NOTES_REQUIRED_SCHEMA` in `src/lib/vault/schema.ts` (patterns#57 —
  Phase 2.0 validates the shape; Phase 2.1+ auto-provisions).

  Canonical reference for the shape: [design doc §5][s5].

[meta-schema]: https://github.com/ParachuteComputer/parachute-app/blob/main/packages/app-host/src/meta-schema.ts
[s5]: https://github.com/ParachuteComputer/parachute.computer/blob/main/design/2026-05-21-parachute-apps-design.md#5-per-ui-metadata-schema--metajson-draft-07
[s18]: https://github.com/ParachuteComputer/parachute.computer/blob/main/design/2026-05-21-parachute-apps-design.md#18-caching--reload-strategy

## [0.1.0-rc.4] - 2026-05-22

- **Fix: resolve `link:` dep in published manifest** (`link:` →
  `^0.1.0-rc.3`). The published tarball for `0.1.0-rc.3` carried
  `"@openparachute/app-client": "link:@openparachute/app-client"` —
  a local-dev-only protocol set up in notes#153 when app-client
  wasn't yet on npm. Installing `@openparachute/notes-ui@0.1.0-rc.3`
  failed at resolve:

  ```
  error: Workspace dependency "@openparachute/app-client" not found
  ```

  `@openparachute/app-client@0.1.0-rc.3` is now published, so we
  switch to a concrete semver. Local dev still resolves the sibling
  through Bun's workspace resolver (it matches by name regardless
  of the version string), and the published tarball declares a
  real, registry-resolvable dependency.

  The repo's `RELEASING.md` grows a "Workspace dependencies" section
  documenting the rule so this can't recur.

## [0.1.0-rc.3] - 2026-05-22

- **Refactor: `VaultClient` subclasses `@openparachute/app-client`'s
  base class** (closes notes#153 reviewer follow-up). app-client
  0.1.0-rc.3 lifted `request`, `requestWithRetry`, and
  `requestCursorWithRetry` to `protected` ([parachute-app#10][app10]),
  so Notes' VaultClient can finally subclass cleanly instead of cloning
  the request loop. Net ~220 lines deleted from `client.ts` and ~690
  from `client.test.ts` (base-class tests now covered by app-client's
  own suite); the Notes-specific surface (`renameTag`, `mergeTags`,
  `deleteTag`, `listTagsWithSchema`, `linkAttachment`,
  `fetchAttachmentBlob`) stays on the subclass.

  Notes' previous narrow-shape `updateTag` override was dropped — the
  base class's wider `TagUpsertPayload`-shaped `updateTag` accepts the
  same `{description, parent_names}` Notes was already passing, and
  `schema-ensure.ts` (the only caller) ignores the return value.

  Bundle delta: +3.8 kB raw / +0.9 kB gzip on the main chunk (the
  subclass mirrors a handful of auth-callback fields on the instance
  so `fetchAttachmentBlob` can drive its own retry loop without
  reaching into the base's `private` state — see file header for
  the rationale).

[app10]: https://github.com/ParachuteComputer/parachute-app/pull/10

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
