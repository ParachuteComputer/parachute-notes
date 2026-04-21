import { PATH_TREE_MODES, type PathTreeMode, usePathTreeMode } from "@/lib/path-tree";
import { isStandalone } from "@/lib/pwa";
import { useToastStore } from "@/lib/toast/store";
import {
  DEFAULT_TAG_ROLES,
  TAG_ROLE_KEYS,
  type TagRoleKey,
  type TagRoles,
  useTagRoles,
  useTags,
  useVaultStore,
} from "@/lib/vault";
import { useEffect, useId, useMemo, useState } from "react";
import { Link, Navigate } from "react-router";

// Per-vault settings UI. Sections stack top-to-bottom; add more as the
// per-vault customization surface grows.
export function Settings() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  if (!activeVault) return <Navigate to="/" replace />;

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-8">
        <nav className="mb-3 text-sm text-fg-dim">
          <Link to="/" className="hover:text-accent">
            ← Home
          </Link>
        </nav>
        <h1 className="font-serif text-3xl tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Configuring <span className="text-fg">{activeVault.name}</span>.
        </p>
      </header>

      <PathTreeSection vaultId={activeVault.id} />
      <TagRolesSection vaultId={activeVault.id} />
      <InstallStateSection />
    </div>
  );
}

function InstallStateSection() {
  // matchMedia is only reliable at render time on some browsers, so sample
  // once on mount.
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    setInstalled(isStandalone());
  }, []);
  if (!installed) return null;
  return (
    <section className="mt-6 rounded-md border border-border bg-card p-4 text-sm">
      <p className="text-fg-muted">
        <span className="mr-2 inline-block rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-300">
          Installed
        </span>
        Parachute Lens is running as an installed app on this device.
      </p>
    </section>
  );
}

const PATH_TREE_MODE_LABELS: Record<PathTreeMode, { title: string; help: string }> = {
  auto: {
    title: "Auto",
    help: "Show the tree only when the vault has enough folders to make it worth the space.",
  },
  always: {
    title: "Always",
    help: "Always show the tree, even on a tag-flat vault.",
  },
  never: {
    title: "Never",
    help: "Hide the tree. The path-prefix text input still works.",
  },
};

function PathTreeSection({ vaultId }: { vaultId: string }) {
  const { mode, setMode } = usePathTreeMode(vaultId);
  return (
    <section className="mt-6 space-y-4 rounded-xl border border-border bg-card p-6">
      <div>
        <h2 className="font-serif text-xl text-fg">Folder tree (Notes sidebar)</h2>
        <p className="mt-1 text-xs text-fg-dim">
          Controls the collapsible folder tree on the notes list page. Auto-detect renders the tree
          when the vault has at least five top-level folders or twenty notes in folders.
        </p>
      </div>
      <fieldset className="space-y-2">
        <legend className="sr-only">Path tree visibility</legend>
        {PATH_TREE_MODES.map((m) => (
          <label key={m} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="path-tree-mode"
              value={m}
              checked={mode === m}
              onChange={() => setMode(m)}
              className="mt-1 accent-accent"
            />
            <span>
              <span className="text-fg">{PATH_TREE_MODE_LABELS[m].title}</span>
              <span className="ml-2 text-xs text-fg-dim">{PATH_TREE_MODE_LABELS[m].help}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}

const ROLE_LABELS: Record<TagRoleKey, { title: string; help: string }> = {
  pinned: {
    title: "Pinned",
    help: "Tag for notes you want at the top of views.",
  },
  archived: {
    title: "Archived",
    help: "Tag for notes you've moved out of the way.",
  },
  captureVoice: {
    title: "Voice capture",
    help: "Default tag for new voice memos.",
  },
  captureText: {
    title: "Text capture",
    help: "Default tag for quick typed notes.",
  },
  view: {
    title: "Saved view",
    help: "Tag the saved-view notes carry. Used to list them in the notes sidebar.",
  },
};

function TagRolesSection({ vaultId }: { vaultId: string }) {
  const { roles, setRoles } = useTagRoles(vaultId);
  const tagsQuery = useTags();
  const pushToast = useToastStore((s) => s.push);
  const datalistId = useId();

  const [draft, setDraft] = useState<TagRoles>(roles);
  useEffect(() => setDraft(roles), [roles]);

  const tagOptions = useMemo(() => {
    const names = (tagsQuery.data ?? []).map((t) => t.name);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }, [tagsQuery.data]);

  const isDirty = TAG_ROLE_KEYS.some((k) => draft[k].trim() !== roles[k]);

  const save = () => {
    setRoles(draft);
    pushToast("Tag roles saved.", "success");
  };

  const resetDefaults = () => {
    setRoles(null);
    setDraft(DEFAULT_TAG_ROLES);
    pushToast("Tag roles reset to defaults.", "success");
  };

  return (
    <section className="mt-6 space-y-4 rounded-xl border border-border bg-card p-6">
      <div>
        <h2 className="font-serif text-xl text-fg">Tag roles</h2>
        <p className="mt-1 text-xs text-fg-dim">
          Point each role at whatever tag your vault already uses. Changes apply to future notes
          only — existing notes keep their current tags.
        </p>
      </div>

      <datalist id={datalistId}>
        {tagOptions.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <div className="space-y-3">
        {TAG_ROLE_KEYS.map((key) => (
          <label key={key} className="block text-sm">
            <span className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-fg-muted">{ROLE_LABELS[key].title}</span>
              <span className="text-xs text-fg-dim">default: #{DEFAULT_TAG_ROLES[key]}</span>
            </span>
            <input
              type="text"
              value={draft[key]}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              list={datalistId}
              placeholder={DEFAULT_TAG_ROLES[key]}
              aria-label={`${ROLE_LABELS[key].title} tag role`}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
            />
            <span className="mt-1 block text-xs text-fg-dim">{ROLE_LABELS[key].help}</span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          type="button"
          onClick={save}
          disabled={!isDirty}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
        >
          Save
        </button>
        <button
          type="button"
          onClick={resetDefaults}
          className="text-sm text-fg-muted hover:text-accent"
        >
          Reset to defaults
        </button>
      </div>
    </section>
  );
}
