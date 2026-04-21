# parachute-lens

A browser-based companion for any Parachute Vault. Vite + React + TypeScript, installable PWA, served at `/lens/` under the ecosystem origin. OAuth 2.1 + PKCE + RFC 7591 DCR against the vault (discovery now probes hub-origin per PR #55).

## Mount-path architecture

Lens lives at `/lens/` externally and uses mount-relative internal routes.

- **Vite `base`** = `/lens/` — asset URLs, PWA manifest scope, service worker
- **BrowserRouter `basename`** = `/lens` (from `import.meta.env.BASE_URL`)
- **Internal routes** — `/`, `/:id`, `/:id/edit`, `/pinned`, `/tags`, `/new`, `/add` — no `/lens/` prefix. React Router v7 ranked routing picks static routes over `/:id` correctly.
- **OAuth redirect URI** — `BASE_URL + "oauth/callback"` via `basePathPrefix()` in `src/lib/vault/oauth.ts`
- **Deep-link shim** — `/:id` + `/:id/edit` redirect to the right internal routes (PR #54) for pre-refactor bookmarks

Canonical source for this convention: `parachute-patterns/patterns/mount-path-convention.md` (once patterns steward publishes).

## Tag roles — the per-vault customization primitive

Features that rely on a specific tag name (e.g. "this is a pinned note", "this
is a voice capture") must **not** hardcode the tag. Different users have
different vault conventions; hardcoding forces one convention on everyone and
collides with tags they already use.

Instead, add the tag to the `TagRoles` object and read it at the point of use.

### Where it lives

- Type + helpers: `src/lib/vault/tag-roles.ts`
- Settings UI: `TagRolesSection` in `src/app/routes/Settings.tsx`
- Storage key: `lens:tag-roles:<vaultId>` in `localStorage` (per-vault)

### Current roles

| Key | Default | Used by |
|---|---|---|
| `pinned` | `pinned` | (reserved for #25 pinned views) |
| `archived` | `archived` | (reserved for #25 archived views) |
| `captureVoice` | `voice` | `src/app/routes/MemoCapture.tsx` |
| `captureText` | `quick` | `src/app/routes/TextCapture.tsx` |

### Adding a new role

1. Add the key to `TagRoles` and a sensible default to `DEFAULT_TAG_ROLES` in
   `src/lib/vault/tag-roles.ts`. Include it in `TAG_ROLE_KEYS` and add an
   entry to `ROLE_LABELS` in `Settings.tsx` so the settings UI renders it.
2. At the feature's point of use, read the role with
   `const { roles } = useTagRoles(activeVault?.id ?? null);`
   and pass `roles.<yourKey>` where the tag is needed. Don't inline the key
   name; don't add a fallback to a literal tag string in the feature code.
3. If your feature queries notes by the role tag, filter on `roles.<yourKey>`
   from `useTagRoles`, not on a hardcoded string.
4. Remember: remapping a role never retags existing notes. The role points at
   the new tag going forward only. Make that explicit in any UI where the
   mapping change has user-visible consequences.

### Pattern: per-vault UI/integration settings in general

Other per-vault settings follow the same shape:

- Plain `load<Feature>(vaultId)` / `save<Feature>(vaultId, x)` /
  `delete<Feature>(vaultId)` around `localStorage` with a key of
  `lens:<feature>:<vaultId>`.
- A thin `use<Feature>(vaultId)` hook that re-reads on `vaultId` change and
  returns `{ value, setValue }`.
- No zustand for these — localStorage is the source of truth and the hook is
  just a convenience.

Reach for this primitive (not a new store pattern) when you need "a small
JSON blob that belongs to a single vault and rarely changes."

## Transcription is vault-level, not Lens-level

Lens uploads audio attachments. When the attachment POST body carries
`{ transcribe: true }`, the vault's transcription-worker picks the job up
and (if scribe is wired) overwrites the note's `_Transcript pending._`
placeholder with the actual transcript. Lens has no scribe client, no
scribe settings UI, and no direct knowledge of whether transcription is
configured — that's the vault's concern. If a user wants voice memos with
transcripts, they configure scribe in the vault once, not per-device.

## Post-merge hygiene

When a PR is merged, locally:

```
git checkout main && git pull
```

Aaron runs lens via `bun link` + `parachute start lens` in development — the linked install follows whatever branch is checked out. Leaving the repo on a feature branch after merge means Aaron's running stale feature-branch code, not the merged main. Caught 2026-04-21.
