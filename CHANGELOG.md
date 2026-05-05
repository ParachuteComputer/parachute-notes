# Changelog

## 0.3.11 (2026-05-04)

First `@latest` publish since launch (`0.3.0`). Bundles every change merged
since launch into a single tagged release plus the discovery-protocol fix
needed for hub well-known to resolve notes correctly.

### Discovery / module protocol

- **fix(spa): serve `.parachute/info` as JSON before SPA catch-all (#102).**
  Notes' Vite preview SPA fallback was matching `/.parachute/info` and
  `/notes/.parachute/info` and returning the index.html shell, so hub's
  well-known builder couldn't read notes' module identity. The
  `infoEndpointPlugin` now registers Connect middleware at both the
  basePath-prefixed path (`/notes/.parachute/info`) and the root
  (`/.parachute/info`) — matching the canonical contract used by vault and
  scribe (no `.json` extension). The middleware runs before sirv and the
  SPA fallback. Build still emits `dist/.parachute/info` as a static asset
  for static-deploy scenarios.

### Accessibility

- **fix(a11y): visible RouteFallback with announceable status (#98).** The
  route-level lazy fallback now renders a visible spinner with `role="status"`
  so screen readers announce route transitions.
- **fix(a11y): explicit `aria-live="polite"` on RouteFallback + smoke test
  (#101).** Hardens the fallback's announcement contract and adds a
  regression test.

### Feature work and cleanup since launch

- **chore: closeout — capture race + queue nit + route-level lazy (#96).**
- **feat: unified single-screen capture (#94).** Capture flow consolidated.
- **feat: saved-view management UI + cluster-A closeout (#93).**
- **sync: reconnect banner + cross-tab vault sync (#92).**
- **Cleanup bundle: pinned hint, group test, vault-switch reset, settings
  drain, module.json (#90).**
- **fix: capture `if_updated_at` baseline for offline note edits (#88).**
- **feat: OAuth via hub-as-issuer with refresh + DCR cache (#83).**
- **release: 0.3.2 (+ ignore `.claude` in lint/test) (#82).**
- **docs: update parachute-cli refs to parachute-hub (#81).**
- **feat: probe local hub at :1939 when same-origin probe fails (#80).**
- **docs(readme): status note — PWA install flow coming with public
  exposure (#77).**

### Repo hygiene

- **chore: gitignore `.claude/` stray artifacts.** Local agent worktrees /
  scheduled-task locks no longer show up as untracked files.

## 0.3.0 (2026-04-23)

Launch.
