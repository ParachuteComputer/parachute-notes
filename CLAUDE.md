# parachute-notes

## Tag roles — the per-vault customization primitive

Features that rely on a specific tag name (e.g. "this is a pinned note", "this
is a voice capture") must **not** hardcode the tag. Different users have
different vault conventions; hardcoding forces one convention on everyone and
collides with tags they already use.

Instead, add the tag to the `TagRoles` object and read it at the point of use.

### Where it lives

- Type + helpers: `src/lib/vault/tag-roles.ts`
- Settings UI: `TagRolesSection` in `src/app/routes/Settings.tsx`
- Storage key: `lens:tag-roles:<vaultId>` in `localStorage` (per-vault, like
  `lens:scribe:<vaultId>`)

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

Other per-vault settings (currently just scribe: `src/lib/scribe/settings.ts`)
follow the same shape:

- Plain `load<Feature>(vaultId)` / `save<Feature>(vaultId, x)` /
  `delete<Feature>(vaultId)` around `localStorage` with a key of
  `lens:<feature>:<vaultId>`.
- A thin `use<Feature>(vaultId)` hook that re-reads on `vaultId` change and
  returns `{ value, setValue }`.
- No zustand for these — localStorage is the source of truth and the hook is
  just a convenience.

Reach for this primitive (not a new store pattern) when you need "a small
JSON blob that belongs to a single vault and rarely changes."
