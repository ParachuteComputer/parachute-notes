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
 *   the SPA reads its own mount from `window.location.pathname` at
 *   runtime. Same bundle, any mount.
 *
 * Detection contract:
 *
 *   `detectMountBase()` returns a path WITHOUT a trailing slash, ready
 *   to feed React Router's `basename` and to prefix OAuth callback
 *   URLs. Recognised mount shapes:
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
 *
 * Why not a `<base href>` or meta-tag contract:
 *
 *   The cleaner architectural answer is a meta tag (or `<base>` tag)
 *   that parachute-app injects into served HTML, declaring the live
 *   mount. We considered it — parachute-app's `http-server.ts`
 *   already has a string-injection hook for the dev-reload script,
 *   so the seam exists. But shipping that would mean a coordinated
 *   parachute-app PR alongside this one, and Aaron's blocked NOW. The
 *   regex-from-pathname shape is contract-free (zero coordination with
 *   parachute-app) and covers every mount the ecosystem currently
 *   produces. If we later need to support arbitrary nested mounts
 *   (`/custom/path/notes/`), revisit then.
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
 * Detect the mount path the SPA is served under by parsing
 * `window.location.pathname`. Returns a path WITHOUT a trailing slash —
 * the shape React Router's `basename` and OAuth redirect URI building
 * both expect.
 *
 * `pathname` overload exists for testability: tests can pass a path
 * directly without monkey-patching `window.location`.
 */
export function detectMountBase(pathname?: string): string {
  const path = pathname ?? (typeof window === "undefined" ? null : window.location.pathname);
  if (path === null || path === undefined) return LEGACY_FALLBACK;
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
