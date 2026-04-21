# Mobile smoke — PWA install + voice memo + offline

Test Lens as a PWA on a real phone. Android first (you have one), iPhone handed off to Jon.

Prereq: tailnet chain is up (`parachute expose tailnet` on your Mac, hub + lens + vault + scribe all running), phone is on your tailnet.

## Android (Chrome)

### 1. Load + install

- [ ] Open Chrome, go to `https://parachute.<tailnet>.ts.net/lens/`
- [ ] Page loads, renders notes UI (header, sidebar, list)
- [ ] Chrome's "Install Parachute Lens" prompt appears in the address bar or menu
- [ ] Tap "Install", confirm
- [ ] Home-screen icon appears, labeled "Parachute Lens"
- [ ] Tap the home-screen icon → app opens fullscreen (no browser chrome)

### 2. OAuth (if not already connected)

- [ ] "Add vault" screen appears (or "Connect" — whichever route lens has)
- [ ] Paste vault URL: `https://parachute.<tailnet>.ts.net/vault/default/`
- [ ] Consent screen shows
- [ ] Password (+ 2FA if configured) succeeds
- [ ] Land on note list

### 3. Read + search

- [ ] Note list loads
- [ ] Tap a note → opens
- [ ] Wikilinks render as clickable
- [ ] Tap a wikilink → navigates to target note
- [ ] Back button works
- [ ] Search input filters notes as you type (debounced)

### 4. Create + edit

- [ ] Tap "New" or `+`
- [ ] Type path + content
- [ ] Save
- [ ] Appears at top of list (recent)
- [ ] Tap to view → content matches
- [ ] Edit → CodeMirror opens — check on-screen keyboard doesn't cover editing area too badly
- [ ] Save works

### 5. Voice memo

- [ ] Navigate to `/memo`
- [ ] First use: browser prompts for microphone permission → Allow
- [ ] Tap-and-hold record button, say "testing voice memo one two three"
- [ ] Release → progress indicator shows "uploading"
- [ ] Note appears with audio attachment
- [ ] If the vault has scribe configured, transcript replaces `_Transcript pending._` in the note within ~10s (transcription is vault-level — Lens just flags `transcribe: true` on the attachment)

### 6. Offline

- [ ] Turn on airplane mode (or disconnect from tailnet)
- [ ] App still loads (service worker serves the shell)
- [ ] Can read cached notes
- [ ] Create a new note while offline → saves to IndexedDB sync queue
- [ ] Note appears in list (marked as pending if the UI shows sync status)
- [ ] Re-connect to tailnet
- [ ] Sync queue drains; note appears on vault (check via another device or curl)

### 7. Graph

- [ ] Open a note, scroll to neighborhood graph
- [ ] Graph renders with the note at center + neighbors
- [ ] Pinch-zoom works
- [ ] Tap a node → navigates to that note

### 8. Back to app after re-launch

- [ ] Close the PWA (swipe away)
- [ ] Re-open from home-screen icon
- [ ] Loads without re-OAuth
- [ ] State preserved (last viewed note, search history, etc. — depends on implementation)

## iPhone (Safari) — hand off to Jon

Same steps as Android, with iOS-specific checks:

- [ ] Use Safari (not Chrome — iOS Chrome is actually Safari wrapper; PWA install is Safari-only on iOS)
- [ ] Add to Home Screen via Share menu → "Add to Home Screen"
- [ ] Home-screen icon launches in fullscreen mode
- [ ] Voice recording: iOS records as `mp4/aac` (not `webm/opus`); vault + scribe should accept either
- [ ] Pull-to-refresh should NOT trigger browser reload (causes full state reset in PWAs — check the manifest's `display: "standalone"` prevents this)
- [ ] Status bar color matches the PWA theme (manifest `theme_color` / `background_color`)

## Known Android quirks

- Chrome may show "See Translation" or other banners occluding the install prompt. Dismiss and re-try.
- Some Android vendors (Samsung, OnePlus) have weird PWA install behavior — Chrome is the lowest-common-denominator to test against.

## Known iOS quirks

- PWA install requires Safari; won't work in Chrome, Firefox, or Brave on iOS.
- Voice memo: iOS requires user-gesture to initiate `MediaRecorder`; the button must be tapped (programmatic start is blocked).
- Offline behavior: iOS aggressively evicts service worker caches when storage is low; large test vaults might surprise you.

## Failure modes

- Install prompt never appears → manifest.json or service worker issue. Open DevTools → Application tab → Manifest, Service Workers.
- OAuth fails → check `/.well-known/oauth-authorization-server` resolves, check mixed-content (HTTPS required for PKCE).
- Voice memo records but upload fails → check CORS on vault, network tab for actual request.
- Transcript never appears → scribe not wired on the vault side (Lens just flags `transcribe: true` on the attachment; the vault's transcription-worker is what invokes scribe). Check the vault's `SCRIBE_URL` / scribe config.

Report outcomes as a checklist back in this file or as a GitHub issue, with device + OS version.
