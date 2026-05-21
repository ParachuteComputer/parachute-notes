# Changelog

## 0.3.16-rc.2 (2026-05-21)

- **refactor(notes): move `InsecureContextBanner` to `src/components/`.**
  The banner was originally defined and exported from
  `src/app/routes/AddVault.tsx` (where it was first used) and imported
  from there by `VaultPopover.tsx` and `VaultStatusBanner.tsx`. That's
  a components-importing-from-routes dependency inversion — routes
  should be leaves. Relocated to
  `src/components/InsecureContextBanner.tsx` with no behavior change;
  three import sites updated. Closes #143.

## 0.3.16-rc.1 (2026-05-20)

- **fix(notes): clear error message when OAuth attempted from insecure
  context.** Aaron hit `Cannot read properties of undefined (reading
  'digest')` on fresh-install testing when connecting Notes (served
  from a non-loopback HTTP origin) to a vault. Root cause: Web Crypto
  (`crypto.subtle`) is only exposed in W3C secure contexts — HTTPS,
  `http://localhost`, or `http://127.0.0.1` — and Aaron's hub URL was
  `http://192.168.1.10:1939`. There is no polyfill: the gating is
  deliberate, and PKCE genuinely can't run there.

  - `src/lib/vault/pkce.ts`: introduce `InsecureContextError` and
    assert `crypto.subtle?.digest` is present at the top of
    `deriveCodeChallenge` (and `crypto.getRandomValues` in
    `generateCodeVerifier` / `generateState`). Throws an
    operator-facing message that names the cause and lists both
    remediations (HTTPS via Tailscale Serve / Cloudflare Tunnel /
    reverse proxy, or switch to the `http://localhost` form).
  - `src/app/routes/AddVault.tsx`: catch `InsecureContextError`
    distinctly in the connect handler and render a new
    `InsecureContextBanner` — amber palette + structured list of
    remediations, deliberately different from the red "Connection
    failed" strip so the operator can tell at a glance this is a
    browser-policy failure, not a "hub is down" failure. Banner
    shows the exact `window.location.origin` so there's no doubt
    which URL the browser flagged.
  - `src/components/VaultPopover.tsx`,
    `src/components/VaultStatusBanner.tsx`: same catch + banner in
    the other two OAuth-initiating call sites so the messaging is
    consistent wherever PKCE can fail.

  Does **not** make PKCE work in insecure contexts (it can't); makes
  the failure mode obvious and points the operator at the two fixes.

## 0.3.15 (2026-05-20)

Stable release. Cumulative changes since `0.3.14`:

- **Format-aware rendering Phase 2** (#139): native rendering for CSV (table), JSON (pretty-print), YAML (formatted), code (syntax-highlighted) note bodies. Auto-detected by content type.
- **Hierarchical capture** (#134, others): autosave draft model + text-size global zoom + capture-flow polish across multiple rc.10-rc.13 iterations.
- **Cross-tab sync** (#131, others): notes edited in one tab reflect in others within seconds.
- **Schema-audit UI** (#136): surface vault schema state from the notes UI.
- **Pending-approval render polish** (#140): dropped the CLI alternative from the OAuth pending-approval screen — the web-based approval path is now the only displayed path. Added "Retry now" button that navigates back to `/add` (works correctly with single-use OAuth codes).

See individual rc entries below for full detail.

## Unreleased

### OAuth pending-approval polish

- **polish(oauth): drop CLI alternative from pending-approval render +
  add retry button (0.3.15-rc.14).** The web-approval path is the path
  now; the `parachute auth approve-client <id>` fallback alongside the
  "Open approval page" button made operators think they still needed
  terminal access, contradicting the hub#266 wizard goal of
  "everything from a browser."

  - `OAuthCallback.tsx`: drop the `<code>parachute auth …</code>`
    block from the pending-approval screen; drop `cliAlternative` from
    the `Status` discriminated union and the `setStatus` call in the
    catch branch.
  - `OAuthCallback.tsx`: add a "Retry now" button alongside "Open
    approval page" so operators can re-attempt OAuth completion after
    approving in the new tab without restarting the connect flow.
    Implementation uses `window.location.reload()` — re-runs the
    `OAuthCallback` effect with the same code/state params.
  - `oauth.ts`: drop `cliAlternative` from `PendingApprovalError`
    (field, constructor, doc-comment) and from `parsePendingApproval`.
    Without an `approve_url`, we now fall through to the generic
    token-exchange-failed error rather than rendering an empty
    "Waiting for hub approval" screen with nothing to click.
  - Hub still emits `cli_alternative` in its `invalid_client` JSON;
    Notes simply ignores it. Pre-#240 hubs that only emit
    `cli_alternative` (no `approve_url`) get the generic error UI.

### Phase 2 polish

- **chore(render): fold reviewer polish nits (0.3.15-rc.13).**
  `escapeHtml` in `src/lib/render/highlight.ts` now escapes `"` (→
  `&quot;`) and `'` (→ `&#x27;`) in addition to `&` / `<` / `>` — current
  callers only use content context, but the generic name invites future
  attribute-context use, so close the hole up front. Added two test
  cases in `format.test.ts` pinning `formatForPath` hidden-file behavior
  (`.gitignore` → `"plain"`, `.ts` → `"code"`) — falls out of the
  extension-driven model, but worth pinning since it was unspecified.

### Phase 2 format-aware rendering

- **feat(render): NoteRenderer dispatches CSV / JSON / YAML / code to
  format-specific renderers (0.3.15-rc.12).** Closes #138. Phase 1
  (parachute-vault) added file-extension support so non-markdown notes can
  be stored; Phase 2 (this) renders them appropriately on the read path.

  A new `NoteRenderer` dispatcher in `src/components/NoteRenderer.tsx`
  examines the note's path extension and routes to one of six renderers:
  - `MarkdownView` (unchanged) — `.md`, `.mdx`, `.markdown`, no extension
  - `CsvRenderer` — `.csv` rendered as an HTML table (first row =
    headers); inline RFC-4180 parser handles quoted cells, escaped
    quotes, newlines-in-cells, CRLF, missing trailing newline
  - `JsonRenderer` — `.json` pretty-printed + syntax-highlighted; invalid
    JSON falls back to the plain monospace block
  - `YamlRenderer` — `.yaml` / `.yml` syntax-highlighted (no re-emit;
    bytes render as authored)
  - `CodeRenderer` — `.ts` / `.tsx` / `.js` / `.jsx` / `.py` / `.rs` /
    `.go` / `.sh` syntax-highlighted via `highlight.js/lib/core` with
    explicit per-language registration (avoids the `/common` bundle's
    ~35 KB of unused languages)
  - `PlainRenderer` — fallback for unknown extensions and parse failures

  All three existing call sites (`NoteView`, `NoteEditor` preview,
  `NoteNew` preview) now go through `NoteRenderer`. The editor preview
  reads `draft.path` so renaming a draft to `.csv` switches the preview
  live.

  No new dependencies — `highlight.js` was already a dep (used by
  rehype-highlight for fenced code in markdown notes); the new renderers
  reuse it directly. The hljs github theme already imported in
  `styles/index.css` styles both code paths uniformly.

  Bundle: `NoteRenderer` chunk 340.80 kB / 103.55 kB gzip (was
  `MarkdownView` 337.29 kB / 102.30 kB gzip) — delta **+3.51 kB raw /
  +1.25 kB gzip**. Total PWA precache 1578.53 KiB (was 1574.85 KiB).

  Deferred (out of scope for #138): MDX with custom React components in
  the markdown body, image-format thumbnails in non-markdown notes, and
  CodeMirror language-aware editing (the editor still uses markdown
  grammar for every note — Phase 3).

### Text-size ramp retune

- **tune(ui): widen text-size ramp + bump default (0.3.15-rc.11).**
  Aaron's testing of rc.10 surfaced two complaints: default felt small
  for a reading-first app (16px root × 1rem prose = 16px reader), and
  largest was a modest ceiling. Retune to a wider ramp Aaron picked
  from a three-option comparison. Rendered px per step:

  | step      | root  | `.prose-note` | CodeMirror editor |
  |-----------|-------|---------------|-------------------|
  | default   | 16px  | 18px          | 15px              |
  | larger    | 18px  | 22px          | 18px              |
  | largest   | 22px  | 26px          | 22px              |

  Default `--font-size-prose` bumped from `1rem` → `18px` (absolute, so
  the rendered target is unambiguous). Defaults for editor 14 → 15.
  Larger / largest blocks retuned to hit the px targets via absolute
  values on prose + editor (no rem×root math to verify). rc.10's CSS
  architecture (root font-size scales chrome via rem cascade, prose +
  editor scale independently) is unchanged — only the rendered ramp
  moves.

  No test changes — `TextSizeControl.test.tsx` asserts attribute
  manipulation, not px values, so it passes unchanged. Intentional:
  pinning px would lock the implementation to numbers Aaron will
  likely keep iterating.

### Capture draft-save + global text-size zoom

- **fix(capture): autosave is now a background draft, not a finalize-and-
  clear (0.3.15-rc.10).** P0 bug from Aaron's morning report: typing
  "hello world" in Capture and waiting 5s wiped the textarea. Root
  cause: `save()`'s success path called `reset()` (clears content +
  path) AND never set `phase: "idle"` back, so `canSubmit` stayed
  false and the textarea (`disabled={phase === "saving"}`) stayed
  locked.
  - The redesign: a new `draftSave()` writes a partial as a background
    draft. First fire enqueues `create-note` with a fresh localId;
    subsequent fires on the same mount enqueue `update-note` for the
    same localId (no duplicate notes). Never touches `phase`, never
    clears `content`. A `draftRef.current` carries
    `{ localId, hasEnqueuedCreate }` across the mount.
  - The manual Capture click (and ⌘↵) is the finalize action — if a
    draft is in flight, it enqueues `update-note` (the create already
    shipped) and clears `draftRef` via `reset()`. Phase explicitly
    resets to `idle` after success so the textarea unlocks for the
    next capture on the same mount.
  - Unmount-flush mirrors the same shape: enqueues `update-note` if
    a draft is in flight (otherwise `create-note`). Nav-away no longer
    duplicates the draft.
  - Subtle "Draft saved · <relative time>" indicator below the
    textarea (right-aligned, `text-fg-dim` micro size). Only renders
    after the first successful draft save.
  - Audio captures still finalize-and-clear via the manual Capture
    click — autosave stays suppressed when `phase === "have-audio"`.

- **fix(ui): text-size knob now scales the whole app, not just `.prose-
  note` + CodeMirror (0.3.15-rc.10).** Aaron reported the Larger /
  Largest radios "appeared to do nothing" on Settings. rc.6's scope
  was too narrow: only `.prose-note` and CodeMirror consumed the
  `--font-size-*` variables, so headers, lists, capture, Settings,
  bottom-tab — none scaled. Added `font-size` on the html root inside
  the `:root[data-text-size="larger"]` (17.5px) and `"largest"` (19px)
  blocks. Tailwind sizes are rem-based, so every chrome element scales
  proportionally. The prose / editor variables stay so the reader
  remains slightly larger than the chrome (read-content > navigation
  feels right).

- **Tests.** 4 existing autosave tests rewritten for draft-save
  semantics — assert queue rows directly instead of "Captured." toast,
  assert content is preserved across autosaves (the bug), assert
  update-note enqueues on the second draft fire and on unmount-flush
  after a draft. Test names renamed to reflect the new model.

### Schema-ensure audit UI — Settings panel + connect-time banner

- **feat(schema): audit UI for the required Notes schema (0.3.15-rc.9).**
  Closes notes#129. Builds directly on rc.8's `NOTES_REQUIRED_SCHEMA` +
  `ensureNotesSchema`. Until now schema-ensure was first-capture-driven
  (idempotent, silent). This PR adds the operator-facing audit: a
  Settings panel that shows expected-vs-actual for each declared tag, a
  connect-time banner that surfaces when the active vault is missing or
  has misaligned tags, and a one-click "Set up missing tags" action.
  - **`auditSchema(client)`** (`src/lib/vault/schema-audit.ts`) calls
    `GET /api/tags?include_schema=true` and diffs each declared tag
    against the vault row. Returns `{ ok, missing, misaligned, rows }`
    with per-tag `differences: ("description" | "parent_names")[]`.
    Treats null and empty-array `parent_names` as equivalent.
  - **`VaultClient.listTagsWithSchema()`** wraps the schema-detail
    variant of `GET /api/tags`. Narrow return type — only the fields
    audit reads.
  - **`fixSchema(vaultId, client)`** in `schema-ensure.ts` is the
    user-driven entry point. Bypasses the per-session ensure guard
    (user explicitly asked to write), rethrows on failure so UI can
    show "fix failed" toast / banner error, and marks the vault as
    ensured on success so subsequent first-captures don't redo work.
  - **`useSchemaAuditStore`** (volatile, not persisted) holds per-vault
    audit results with `ensure(vaultId, client)` (cache-respecting,
    5min TTL) + `refresh()` (force-refetch) + `set()` (post-fix update
    without refetch). Mirrors `auth-halt-store` shape.
  - **`useSchemaBannerStore`** (persisted) tracks per-vault banner
    dismissal under `notes:schema-banner-dismissed:<vaultId>` so
    dismissal survives reloads. Mirrors `auth-halt-store` cross-tab
    pattern.
  - **`SchemaAuditRunnerMount`** at the App root auto-fires `ensure`
    when the active vault or its client changes. No DOM, only effect.
  - **`SchemaAuditBanner`** (`src/components/`) renders below
    `VaultStatusBanner` — amber/yellow, less urgent than auth-halt or
    unreachable. Two affordances: "Set up" → calls `fixSchema` then
    marks the cached audit ok; "Dismiss" → persists per-vault. Uses
    `<output role="status" aria-live="polite">` rather than `<div
    role="status">` per Biome's a11y rule.
  - **Settings "Vault schema" section** (top of the Settings page —
    above Text size). Status pill (ok = emerald, !ok = amber), per-tag
    rows showing expected description + parent_names, a "Refresh" link
    and a "Set up missing tags" button. "Schema updated." toast on
    success.
  - **Tests.** 7 new in `schema-audit.test.ts` (ok / missing / desc
    misalignment / parent_names misalignment / null-vs-empty
    equivalence / row completeness / extra-tags-don't-flag). 3 new in
    `schema-ensure.test.ts` (fixSchema bypasses session guard /
    rethrows on failure / marks ensured after success). 4 new in
    `schema-banner-store.test.ts` (dismiss + clear + multi-vault +
    cross-tab reload). 6 new in `SchemaAuditBanner.test.tsx` (renders
    nothing pre-audit / nothing on ok / renders on misalign / hides
    when dismissed / Dismiss persists / Set up calls updateTag for
    each + marks ok).

### Capture reshape — hierarchical capture/* tags + schema-ensure + option (d) + path-collision fix

- **feat(capture): hierarchical capture tags + schema-ensure + option (d) +
  path-collision fix (0.3.15-rc.8).** Closes notes#126 (reshaped scope).
  Builds on rc.7's `quickPath()` pre-fill with Aaron's confirmed `capture/*`
  classification model + several reviewer follow-ups bundled.
  - **`NOTES_REQUIRED_SCHEMA` in `src/lib/vault/schema.ts`** declares the
    `capture` parent + `capture/text` + `capture/voice` children with
    `parent_names: ["capture"]`. First instance of patterns#57 (surface-
    declares-required-schema). Future extensions (`capture/photo`,
    `capture/web-clip`) slot in without rename.
  - **Tag Role defaults rename**: `DEFAULT_TAG_ROLES.captureText` →
    `"capture/text"`, `DEFAULT_TAG_ROLES.captureVoice` → `"capture/voice"`.
    **Existing vaults preserve their stored values** — if a user has
    `captureText = "quick"` from rc.6, that stays. Only fresh-vault
    inheritance changes.
  - **`update-tag` client method + idempotent `ensureNotesSchema()` hook**
    in `src/lib/vault/schema-ensure.ts`. PUTs each declared tag against
    `/api/tags/:name` (field-merged vault-side; no-op when already-correct).
    Per-vault per-session ref guard so repeated captures don't hammer the
    vault. Failure rolls back the guard so the next capture retries.
    Captures-side wiring is fire-and-forget — schema setup doesn't block
    the user's save.
  - **Option (d) bundled** (was the closed PR #131): clearing the path
    input reverts to the mount-time generated value, never vault-picks.
    Resolution becomes `pathOverride.trim() || generatedPathRef.current`.
    The rc.6 `memoPath()` audio-only fallback is dropped — unreachable
    under option (d). One canonical Notes-side rule, no phase-dependent
    forks. Aaron's framing: don't re-introduce hidden vault-picks magic
    via the cleared-input path.
  - **Path-collision fix** (raised in #130 review): `quickPath()` is
    second-granularity, so two captures within the same wall-clock second
    would land at the same path. `reset()` after successful save now
    regenerates `quickPath()` AND updates the input — but only when the
    operator hasn't manually edited. A user typing an explicit path
    (e.g. `Daily/2026-05-12`) is capturing into a deliberate location;
    don't fight them. `pathEditedRef` tracks edit intent; restoring the
    generated value clears the flag.
  - **Placeholder text** updated: `"(blank → vault picks)"` →
    `"(blank → uses generated path)"` so the UI itself describes the
    option-(d) rule.
  - **Tests.** 6 new in `schema-ensure.test.ts` (declaration-order PUTs,
    parent-before-children, per-session per-vault idempotence, multi-vault
    independence, retry-on-failure, swallow-failure-doesn't-throw). 2 new
    in `Capture.test.tsx` (regen-on-reset when unedited; preserve user
    edit across reset). 4 existing tests flipped where defaults changed
    (captureText → `capture/text`, captureVoice → `capture/voice`,
    text+voice combined now both hierarchical) or option (d) changed
    semantics ("empty path reverts to generated", "audio-only cleared
    path reverts to generated"). `Capture.test.tsx` adds a `vi.mock` for
    `@/lib/vault/schema-ensure` so capture tests don't hit the real PUT
    (covered by schema-ensure.test.ts).

### Not in scope (deferred)

- Full Settings audit UI + connect-time banner → notes#129.
- Per-vault customization of path templates → notes#128.

### Text-size shortcuts + header control; Capture path pre-fill

- **feat(ui): accessible text-size (shortcuts + header) + locally-generated
  capture path (0.3.15-rc.7).** Two follow-ups to rc.6 bundled because
  they touch the same chrome / Capture surfaces. Closes notes#127 + #126.
  - **Text-size keyboard shortcuts (notes#127).** Cmd+= / Cmd+Plus steps
    up the ramp (default → larger → largest → default); Cmd+- /
    Cmd+Underscore steps down; Cmd+0 resets to default. Bound at the
    app root via `TextSizeShortcutsMount` so the listener lives in one
    place — the visible `TextSizeControl` in the Header would otherwise
    register twice (desktop + mobile menu). Ignored when Shift, Alt, or
    neither modifier is held.
  - **Header chrome control (notes#127).** Adds `TextSizeControl` — a
    small "Aa" button next to the existing chrome (Install / Theme).
    Click opens a 3-option popover (Default / Larger / Largest) with a
    ✓ on the active row. Same persist + apply path as the Settings
    dropdown via `lib/text-size.ts`. A same-tab `CustomEvent` keeps the
    popover's active indicator in sync when a shortcut or sibling
    control changes the size (the `storage` event only fires
    cross-tab). Lives on both desktop and mobile menu so phones (no
    keyboard) keep the path.
  - **`nextTextSize` / `previousTextSize` helpers.** Added to
    `lib/text-size.ts` for the shortcut handlers; mirror `nextTheme`
    in `theme.ts` shape. Each direction is explicit so the call site
    doesn't have to think about wrap-around arithmetic.
  - **Capture path pre-fill (notes#126).** Adds `quickPath()` helper
    next to `memoPath()` in `lib/capture/recorder.ts`. Same
    `<root>/YYYY/MM-DD/HH-MM-SS` shape under `Notes/`. Capture's
    `pathOverride` state is now seeded with `quickPath()` on mount so
    the operator sees the generated path the moment they expand More
    fields — no more invisible "vault auto-assigns" magic.
  - **Audio-only memos.** With the pre-fill non-empty, audio captures
    also land under `Notes/` by default (parallel to the text case).
    Operators who want the old `Memos/` rule can clear the path input
    — the existing rc.6 fallback to `memoPath()` for audio-only with
    no override is preserved as the escape valve. New test pins this.
  - **Tests.** 2 new in `text-size.test.ts` (cycle direction helpers).
    12 new in `TextSizeControl.test.tsx` (button + popover behavior,
    keyboard handlers, same-tab sync). 1 new in `recorder.test.ts`
    (quickPath shape). 2 new in `Capture.test.tsx` (pre-fill is
    editable + saved; audio-only fallback to `memoPath` when path is
    cleared). Existing tests updated where pre-fill changed observable
    behavior (text-only payload now carries `Notes/...`, combined
    text+voice payload now carries `Notes/...` instead of vault-picks).

### Capture polish + view-level text-size

- **feat(ui): unified capture surface refinements + view-level text-size
  control (0.3.15-rc.6).** Two items from `design/2026-05-12-notes-ui-audit.md`
  §3 (north-star "Apple-Notes-grade ease"): #12 (unified capture) and
  #11 (text-size knob). Both behind one PR per the audit's sequencing.
  - **More fields panel (audit §3 #12).** Adds a collapsible
    `<details>` to `Capture` exposing a path override + summary input —
    the audit's "structured form when wanted, hidden when not". Defaults
    to closed so the textarea stays the unfocused-friction default;
    operators who need to set an explicit path (e.g. capturing into
    `Daily/2026-05-12`) get the form without leaving Capture. Empty
    path means "let the vault auto-assign"; empty summary means "no
    metadata.summary". Path override wins over the audio-only memo
    auto-path.
  - **Inactivity autosave (audit §3 #12).** Capture now flushes
    save() after 5 seconds of editing inactivity in addition to the
    existing unmount-flush — protects against browser crashes and
    accidental closes. Skipped while audio is staged (manual Capture
    click only), while recording/saving, and while body is empty.
  - **Escape hatch to NoteNew.** A "Need to attach a file? Open the
    full editor" link in the More-fields panel points at `/new`, which
    still renders `NoteNew` for the file-drop / file-picker /
    `link-on-create` flow. Capture is canonical for the 95% quick path;
    the heavy editor stays available for the 5% that needs attachments.
    Cmd+K keeps both entries for discoverability.
  - **View-level text-size knob (audit §3 #11).** New `lib/text-size.ts`
    mirrors `lib/theme.ts` shape — three steps (Default / Larger /
    Largest), per-device localStorage at `notes:textSize`, applied via
    a `data-text-size` attribute on `<html>`. `styles/index.css`
    defines `--font-size-prose` + `--font-size-editor` CSS variables;
    `.prose-note` reads the prose one (markdown reader), `CodeMirror`
    reads the editor one. Settings gains a `TextSizeSection` with
    three radio buttons that apply + persist in one motion. Markdown
    on disk is unaffected — pure view preference.
  - **Tests.** 4 new in `text-size.test.ts` (round-trip, default
    handling, data-attribute application, labels). 8 new in
    `Capture.test.tsx` covering disclosure default-closed, path/summary
    override payload shape, empty-path fallback, path-override winning
    over memo auto-path, autosave-after-5s, edit-resets-timer,
    empty-content-no-autosave, audio-staged-suppresses-autosave.
  - **Unmount-flush hardening.** The unmount enqueue now swallows IDB
    teardown rejections (SyncProvider closing its handle in the same
    tick is a known race documented in `SyncProvider.tsx:60`). No
    user-visible surface to report failures during nav-away anyway.

### Multi-vault hubs — consume per-vault services keys

- **feat(oauth): prefer `services["vault:<name>"].url` in OAuthCallback
  (0.3.15-rc.5).** Companion consumer for the hub-side change in
  hub#247/#248. Hub now emits per-vault entries in the OAuth services
  catalog alongside the legacy collapsed `vault` key; OAuthCallback
  picks the entry matching the token's `vault` claim. Before this PR,
  every vault on a multi-vault hub (boulder, gitcoin, techne) would
  resolve to the collapsed-first-vault URL, so VaultRecords collided
  on URL and only one entry survived in Manage Vaults. Fallback chain
  is per-vault key → collapsed `vault` → `pending.issuerUrl`, so
  pre-#247 hubs and standalone vaults keep working unchanged. Tests
  cover all three fallback rungs. Closes notes#121.

### Retry-now integration test

- **test(ui): integration coverage for Retry-now → real client → store flush
  (0.3.15-rc.4).** Adds `VaultStatusBanner.retry.integration.test.tsx`
  exercising the load-bearing recovery interaction end-to-end through a
  real `VaultClient` (no `useActiveVaultClient` mock). Three response
  paths covered: 200 (vault healthy) + 401 (vault answering, still
  auth-broken) both flush the store and unmount the banner via the real
  `onReachability("healthy")` callback; 502 keeps the banner up and
  extends `backoffIndex`. Regression-pins the precedence flow so a
  future refactor that disconnects the client→store wiring fails this
  test instead of slipping through. Closes notes#118.

### LAN-IP vaults get the operator hint

- **fix(ui): RFC 1918 detection in `isLoopbackOrLocal` (0.3.15-rc.3).**
  The banner from rc.2 only showed the `Try `parachute start vault``
  operator hint for `localhost` / `127.0.0.1` / `.local` URLs, so a
  self-hosted vault on a home LAN at e.g. `192.168.1.10:1940` got no
  hint even though the recovery is identical. Adds RFC 1918 private
  IPv4 range matching (10/8, 172.16-31/12, 192.168/16). Tailnet and
  cloud vaults remain correctly unaffected. Tests cover all three
  ranges, the 172.15/172.32 boundary excludes, and public-IP
  negatives that share a prefix digit. Closes notes#117.

### Graceful vault-unreachable UX

- **feat(ui): banner + status dot + retry backoff when vault is unreachable
  (0.3.15-rc.2).** Replaces the raw 502 / blank-screen + console-error
  behaviour Aaron hit after a Mac restart left vault un-started (notes#113).
  - **`VaultUnreachableError`** distinguishes 5xx and network-level failures
    (ECONNREFUSED, DNS, fetch TypeError) from auth/conflict/not-found in
    `VaultClient.request()`. Auth-halt and 4xx errors still mean the vault
    *answered*, so they don't touch reachability state.
  - **`useVaultReachabilityStore`** runs the per-vault state machine
    `healthy → retrying → down`. Promotion to `down` after 3 consecutive
    failures (or an immediate `ECONNREFUSED`). Exponential backoff for the
    recovery probe: 1s → 2s → 4s → 8s → 16s → 30s (cap matches the sync
    engine tick). Not persisted to localStorage — unlike auth-halt, this
    state should re-probe from scratch on reload.
  - **`useReachabilityProbe`** schedules a single `setTimeout` per active
    vault, pings `GET /api/vault` at `nextProbeAt`, and on success the
    client's own `onReachability("healthy")` flush clears the store. Probe
    auto-invalidates `notes`/`tags`/`vaultInfo`/`note` query keys so cached
    data refreshes on recovery.
  - **`VaultStatusBanner`** (renamed from `ReconnectBanner`) covers both
    failure axes with one component: auth-halt has precedence over
    unreachable (different recovery paths — re-OAuth vs wait/retry). The
    unreachable banner offers `Retry now` (forces a probe + invalidates
    queries) and `Dismiss` (one-shot escape hatch via `resetToHealthy`).
    Local-vault operator hint (`Try `parachute start vault``) is shown
    only for loopback / `.local` URLs.
  - **`SyncStatusIndicator`** gains a 5th tone `unreachable` ("Vault down",
    `bg-red-400`). Precedence: `halted → unreachable → offline → syncing →
    online`. Auth-halt still wins; unreachable beats `navigator.onLine`
    because it points at a more specific recovery.
  - **`QueryProvider` retry policy** pauses React Query retries on
    `VaultUnreachableError` once the store crosses `down` — this is what
    stops the `/api/notes` 404 hammering in the vault log (every list/get
    call legitimately hits `/api/notes?...`; nothing was stopping React
    Query from retrying twice per query forever). While still `retrying`
    (≤2 failures) one retry is allowed so a single blip self-heals
    without ever showing the banner.
  - **Tests.** `client.test.ts` adds 502/503/TypeError/AbortError mappings
    and the `healthy` reset on 4xx. `reachability-store.test.ts` covers
    the full state machine + backoff index growth + per-vault isolation.
    `VaultStatusBanner.test.tsx` covers both modes, the auth-halt-wins
    precedence, the loopback hint, the Retry/Dismiss buttons, and
    `isLoopbackOrLocal`. `SyncStatusIndicator.test.tsx` adds the
    `Vault down` tone test (above offline in precedence).

### Vault popover (header)

- **feat(ui): vault popover + hub-discovery + OAuth `vault=<name>` hint
  (0.3.15-rc.1).** Replaces the bare `<select>` switcher in the header
  with a popover that surfaces the operator's full hub-side vault list
  alongside the locally-connected vaults. Implements §2 of
  [`design/2026-05-12-notes-ui-audit.md`](./design/2026-05-12-notes-ui-audit.md);
  the first item in the §5 ship sequence.
  - **Two sections.** "Connected" lists vaults Notes has tokens for
    (active vault gets a filled accent dot + "current" tag; the rest
    are one click to switch). "Available from your hub" lists vaults
    published at `<hub>/.well-known/parachute.json` that Notes hasn't
    connected to yet, each with an inline "Connect" button. Footer
    links to the existing `/vaults` management page.
  - **Hub-origin discovery.** Derived from `VaultRecord.issuer` (which
    under hub-as-issuer is the hub origin itself, captured at OAuth
    time in `OAuthCallback.tsx`) — no schema change to the stored
    record, no migration. For a standalone-vault deployment the
    well-known fetch returns no peers and the Available section is
    omitted (graceful degradation).
  - **OAuth `vault=<name>` hint (Path A).** `beginOAuth` now accepts an
    `options.params` bag appended to the authorize URL last, guarded
    so caller-supplied params can never overwrite standard OAuth/PKCE
    params. Notes sends `vault=<name>` so future hubs that adopt the
    hint can pre-select on the consent screen; pre-#240 hubs ignore it
    and the picker renders as today.
  - **Mobile.** Same component, rendered as `variant="inline"` inside
    the existing hamburger menu — replaces the mobile `<select>` plus
    the standalone "Manage vaults" button.

### Design

## 0.3.14 (2026-05-11)

### OAuth pending-approval UX

- **feat(oauth): consume hub's `approve_url` field from the
  pending-approval response.** When `/oauth/token` answers with
  `error: "invalid_client"` and the hub#240 hint fields
  (`approve_url`, `cli_alternative`), `completeOAuth` now throws a
  typed `PendingApprovalError` instead of folding the raw JSON into a
  generic "Token exchange failed" string. The `OAuthCallback` route
  renders a dedicated "Waiting for hub approval" screen with a
  one-click "Open approval page" link (the hub's
  `/admin/approve-client/<id>` SPA route) plus the
  `parachute auth approve-client …` CLI as a secondary path.
  Back-compat: pre-#240 hubs that emit only `cli_alternative` still
  surface the friendly screen with the CLI fallback alone; an
  `invalid_client` response with no hint fields (unknown client_id,
  revoked client) falls through to the generic error UI rather than
  getting swallowed into the approval flow. Defense-in-depth: only
  `http(s)` `approve_url` schemes make it to the rendered `href` —
  any other scheme (`javascript:`, malformed) is dropped at parse
  time, with the CLI alternative still surfaced if present.

## 0.3.13 (2026-05-10)

### Module manifest

- **docs(module): declare `uiUrl: "/notes"` per
  [`patterns/module-ui-declaration.md`](https://github.com/ParachuteComputer/parachute-patterns/blob/main/patterns/module-ui-declaration.md).**
  Lets hub render the Notes discovery tile dynamically from the
  well-known doc instead of from its hardcoded `SERVICE_LABELS` map.
  No runtime change in Notes itself; the field is opaque to the PWA.

## 0.3.12 (2026-05-09)

### OAuth / DCR

- **feat(oauth): include credentials on DCR registration so hub session
  cookie reaches /oauth/register (#106).** Adds `credentials: 'include'`
  to the `POST /oauth/register` fetch in `src/lib/vault/discovery.ts` so
  the browser sends the `parachute_hub_session` cookie when registering.
  Companion to hub#199 (hub-side auto-approve) and agent#140 (sibling
  fix on agent's SPA).

  **Scope:** Same-origin auto-approve (notes loaded at `<hub>/notes/` →
  DCR at `<hub>/oauth/register`) activates as soon as hub#199/200 lands.
  Cross-origin auto-approve (e.g. notes on a cloudflare URL → hub on
  tailnet) does NOT work yet — it requires hub-side CORS with
  `Access-Control-Allow-Credentials`, a first-party origin allowlist, and
  a `SameSite` relaxation or alternative credential, tracked at
  parachute-hub#201. Until that lands, cross-origin DCR continues to
  register as `pending` and requires manual `parachute auth approve-client`.

## 0.3.11 (2026-05-05)

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
