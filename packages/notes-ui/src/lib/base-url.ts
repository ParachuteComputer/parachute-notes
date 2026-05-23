/**
 * Runtime mount-path detection for the Notes UI bundle.
 *
 * Why runtime, not build-time:
 *
 *   The same built `dist/` may be served at different mount paths
 *   depending on who hosts it:
 *
 *     - Legacy notes-daemon          → `/notes/`
 *     - parachute-app (default name) → `/app/notes/`
 *     - parachute-app (custom slug)  → `/app/<name>/`
 *
 *   Hard-coding `base: "/notes"` at Vite build time (the old shape)
 *   bakes asset URLs and the React Router basename into one mount —
 *   the bundle can't relocate without a rebuild. That's exactly the
 *   bug Aaron hit: the published 0.1.0 bundle 404'd / mis-routed when
 *   parachute-app mounted it at `/app/notes/`, because `<Router
 *   basename="/notes">` refused to match `/app/notes/...` and the
 *   OAuth redirect URI registered with the AS pointed at the wrong
 *   path.
 *
 *   The fix: Vite emits relative asset URLs (`base: ""` → `./assets/
 *   ...`) which the browser resolves against the document's URL, and
 *   the SPA reads its own mount at runtime — either from a meta tag
 *   the host injects (canonical) or, as a fallback, by regex against
 *   `window.location.pathname`. Same bundle, any mount.
 *
 * Detection contract:
 *
 *   `detectMountBase()` returns a path WITHOUT a trailing slash, ready
 *   to feed React Router's `basename` and to prefix OAuth callback
 *   URLs. Recognised mount shapes (regex fallback):
 *
 *     - `/app/<slug>` — parachute-app hosts (the future-default)
 *     - `/notes`     — legacy notes-daemon host (preserved for
 *                       back-compat through notes-daemon's retirement)
 *
 *   Slug grammar matches parachute-app's `meta-schema.ts` `PATH_PATTERN`
 *   (single segment of `[a-z0-9][a-z0-9_-]*`). A pathname under a
 *   recognised mount returns the matching prefix; anything else falls
 *   back to `/notes` so an unmounted load (operator types the bare
 *   origin) still degrades into the historical default rather than
 *   blanking the router.
 *
 *   Server/test environments without `window` return `/notes` — the
 *   legacy default — so tests that don't explicitly stub a pathname
 *   keep the pre-refactor behaviour.
 */

/**
 * Detect the mount path the SPA is served under at runtime.
 *
 * Two-tier strategy:
 *
 *   1. **Canonical** — read `<meta name="parachute-mount" content="/app/<name>">`
 *      injected by parachute-app's static-serve. This is the load-bearing path
 *      once parachute-app#21 ships. Apps read what the host explicitly told them;
 *      no guessing.
 *
 *   2. **Interim fallback** — regex-detect against known parachute mount
 *      patterns from `window.location.pathname`. Works without parachute-app
 *      cooperation, but assumes the bundle knows the host's mount conventions.
 *      Will phase out once tier 1 is universal.
 *
 * Returns a path-without-trailing-slash, suitable for React Router's basename
 * and as a prefix for OAuth callback URLs.
 *
 * Future: this logic will move into `@openparachute/app-client`'s
 * `getMountBase()` helper (issue parachute-app#22). Apps consume that abstraction; this file
 * exists until that lands.
 */

/**
 * Recognised mount-prefix patterns. Order matters — most specific first.
 *
 *   - `/app/<slug>`: parachute-app hosts. Slug matches PATH_PATTERN
 *     in parachute-app's meta-schema. The capture group is the full
 *     two-segment prefix (slash included) so the regex match returns
 *     `/app/notes` directly.
 *   - `/notes`: legacy notes-daemon mount. Preserved as a recognised
 *     shape until notes-daemon is fully retired (Phase 4 of the
 *     migration arc per parachute.computer design doc §16).
 */
const MOUNT_PATTERNS: readonly RegExp[] = [
  /^(\/app\/[a-z0-9][a-z0-9_-]*)(?=\/|$)/,
  /^(\/notes)(?=\/|$)/,
] as const;

/** Fallback when no recognised mount matches. Preserves the legacy default. */
const LEGACY_FALLBACK = "/notes" as const;

/**
 * Detect the mount path the SPA is served under at runtime.
 *
 * Two-tier resolution:
 *
 *   1. Check for `<meta name="parachute-mount" content="/app/<name>">`
 *      injected by the host (canonical contract once parachute-app#21 ships).
 *   2. Fall back to regex-matching `window.location.pathname` against the
 *      known mount patterns.
 *
 * Returns a path WITHOUT a trailing slash — the shape React Router's
 * `basename` and OAuth redirect URI building both expect.
 *
 * @param pathname  Optional pathname for the regex fallback. Tests pass this
 *                  directly without monkey-patching `window.location`.
 * @param doc       Optional Document for the meta-tag check. Tests inject a
 *                  stub to exercise the canonical branch.
 */
export function detectMountBase(pathname?: string, doc?: Document): string {
  // 1. Canonical contract: read the meta tag parachute-app injects on serve.
  //    Once parachute-app#21 ships, this is the load-bearing path.
  if (typeof document !== "undefined" || doc !== undefined) {
    const d = doc ?? document;
    const meta = d.querySelector<HTMLMetaElement>('meta[name="parachute-mount"]');
    const value = meta?.content?.trim();
    if (value && value.startsWith("/")) {
      return value.replace(/\/$/, "");
    }
  }

  // 2. Fallback: regex-detect from window.location.pathname.
  //    Interim until parachute-app#21 lands.
  const path = pathname ?? (typeof window === "undefined" ? null : window.location.pathname);
  if (path == null) return LEGACY_FALLBACK;
  for (const pattern of MOUNT_PATTERNS) {
    const match = pattern.exec(path);
    if (match?.[1]) return match[1];
  }
  return LEGACY_FALLBACK;
}

/**
 * Convenience accessor: the mount base with a trailing slash, suitable
 * for building absolute URLs (e.g. PWA manifest start_url, OAuth
 * callback construction). `/app/notes` → `/app/notes/`.
 */
export function detectMountBaseWithSlash(pathname?: string): string {
  const base = detectMountBase(pathname);
  return base.endsWith("/") ? base : `${base}/`;
}
