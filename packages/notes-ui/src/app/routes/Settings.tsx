import { PATH_TREE_MODES, type PathTreeMode, usePathTreeMode } from "@/lib/path-tree";
import { isStandalone } from "@/lib/pwa";
import {
  TEXT_SIZES,
  type TextSize,
  applyTextSize,
  readStoredTextSize,
  textSizeLabel,
  writeStoredTextSize,
} from "@/lib/text-size";
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
import { useActiveVaultClient } from "@/lib/vault/queries";
import type { TagAuditRow } from "@/lib/vault/schema-audit";
import { useSchemaAuditStore } from "@/lib/vault/schema-audit-store";
import { useSchemaBannerStore } from "@/lib/vault/schema-banner-store";
import { fixSchema } from "@/lib/vault/schema-ensure";
import { useEffect, useId, useMemo, useState } from "react";
import { Link, Navigate } from "react-router";

// Per-vault settings UI. Sections stack top-to-bottom; add more as the
// per-vault customization surface grows.
export function Settings() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  if (!activeVault) return <Navigate to="/" replace />;

  return (
    <div className="mx-auto max-w-2xl px-4 py-7 md:px-6 md:py-12">
      <header className="mb-8">
        <nav className="mb-3 text-sm text-fg-dim">
          <Link to="/" className="hover:text-accent">
            ← Home
          </Link>
        </nav>
        <h1 className="font-serif text-2xl tracking-tight md:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Configuring <span className="text-fg">{activeVault.name}</span>.
        </p>
      </header>

      <VaultSchemaSection vaultId={activeVault.id} />
      <TextSizeSection />
      <PathTreeSection vaultId={activeVault.id} />
      <TagRolesSection vaultId={activeVault.id} />
      <InstallStateSection />
    </div>
  );
}

// "Vault schema" section (notes#129): surfaces the audit result for the
// active vault + offers a one-click fix. The audit runs automatically at
// the App root via `SchemaAuditRunnerMount`; this section reads the cached
// result and exposes a manual Refresh. The fix path uses `fixSchema` from
// schema-ensure.ts (bypasses the per-session ensure guard since this is
// the user explicitly asking us to write).
function VaultSchemaSection({ vaultId }: { vaultId: string }) {
  const audit = useSchemaAuditStore((s) => s.byVault[vaultId] ?? null);
  const refresh = useSchemaAuditStore((s) => s.refresh);
  const setAudit = useSchemaAuditStore((s) => s.set);
  const clearDismissed = useSchemaBannerStore((s) => s.clearDismissed);
  const client = useActiveVaultClient();
  const pushToast = useToastStore((s) => s.push);
  const [fixing, setFixing] = useState(false);

  const onRefresh = async () => {
    if (!client) return;
    await refresh(vaultId, client);
  };

  const onFix = async () => {
    if (!client) return;
    setFixing(true);
    try {
      await fixSchema(vaultId, client);
      // Update cached audit to ok without a refetch — the fix wrote every
      // declared row, so the diff resolves clean. Clear the dismissed
      // flag so a future drift (user-edited tag) re-surfaces the banner.
      const okRows = audit?.result?.rows.map((r) => ({
        ...r,
        status: "ok" as const,
        differences: [],
      }));
      if (okRows) setAudit(vaultId, { ok: true, missing: [], misaligned: [], rows: okRows });
      clearDismissed(vaultId);
      pushToast("Schema updated.", "success");
    } catch (err) {
      pushToast(
        err instanceof Error ? `Schema fix failed: ${err.message}` : "Schema fix failed.",
        "error",
      );
    } finally {
      setFixing(false);
    }
  };

  // Pre-audit (mount before runner fires) and error states get a small
  // status hint rather than a full per-tag table.
  const isLoading = audit?.loading ?? !audit;
  const result = audit?.result ?? null;
  const error = audit?.error ?? null;

  return (
    <section className="mt-6 space-y-4 rounded-xl border border-border bg-card p-6">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl text-fg">Vault schema</h2>
          <p className="mt-1 text-xs text-fg-dim">
            Notes declares three tags it uses to classify captures: <code>capture</code>,{" "}
            <code>capture/text</code>, <code>capture/voice</code>. This panel confirms the active
            vault has them set up; one click writes any missing or misaligned rows. Doesn't touch
            your Tag Role choices below.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={isLoading || !client}
          className="shrink-0 text-xs text-fg-dim hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? "Checking…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          Audit failed: {error}
        </p>
      ) : null}

      {!result && !error ? <p className="text-xs text-fg-dim">Loading audit…</p> : null}

      {result ? (
        <>
          <SchemaStatusPill ok={result.ok} />
          <ul className="space-y-2">
            {result.rows.map((row) => (
              <SchemaRow key={row.name} row={row} />
            ))}
          </ul>
          {!result.ok ? (
            <button
              type="button"
              onClick={() => void onFix()}
              disabled={fixing || !client}
              className="min-h-11 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {fixing ? "Setting up…" : "Set up missing tags"}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function SchemaStatusPill({ ok }: { ok: boolean }) {
  return (
    <p
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${
        ok ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"
      }`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400"}`}
      />
      {ok ? "Matches Notes' schema" : "Needs setup"}
    </p>
  );
}

function SchemaRow({ row }: { row: TagAuditRow }) {
  const label = row.status === "ok" ? "ok" : row.status === "missing" ? "missing" : "misaligned";
  const labelClass = row.status === "ok" ? "text-emerald-300" : "text-amber-300";
  return (
    <li className="rounded-md border border-border bg-bg/40 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <code className="font-mono text-sm text-fg">{row.name}</code>
        <span className={`text-xs ${labelClass}`}>{label}</span>
      </div>
      {row.status === "misaligned" ? (
        <p className="mt-1 text-fg-dim">Differs in: {row.differences.join(", ")}</p>
      ) : null}
      <p className="mt-1 text-fg-dim">{row.expected.description}</p>
      {row.expected.parent_names ? (
        <p className="text-fg-dim">
          Parent: <code className="font-mono">{row.expected.parent_names.join(", ")}</code>
        </p>
      ) : null}
    </li>
  );
}

// View-level text-size knob — per-device because eye-days vary independently
// of vault. The dropdown applies + persists in one motion via the helpers in
// lib/text-size.ts; App.tsx already applies the stored value on mount, so
// this section's job is just "change + save".
function TextSizeSection() {
  // Lazy initializer reads localStorage during the first render, not in a
  // useEffect afterward — without this the radio briefly renders "Default"
  // before the effect overwrites with the stored value, which the reviewer
  // on #123 flagged as a visible flash.
  const [size, setSize] = useState<TextSize>(() => readStoredTextSize());

  const onChange = (next: TextSize) => {
    setSize(next);
    writeStoredTextSize(next);
    applyTextSize(next);
  };

  return (
    <section className="mt-6 space-y-4 rounded-xl border border-border bg-card p-6">
      <div>
        <h2 className="font-serif text-xl text-fg">Text size</h2>
        <p className="mt-1 text-xs text-fg-dim">
          Affects the editor and rendered notes on this device. Your markdown isn't changed.
        </p>
      </div>
      <fieldset className="space-y-2">
        <legend className="sr-only">View text size</legend>
        {TEXT_SIZES.map((s) => (
          <label key={s} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="text-size"
              value={s}
              checked={size === s}
              onChange={() => onChange(s)}
              className="mt-1 accent-accent"
            />
            <span className="text-fg">{textSizeLabel(s)}</span>
          </label>
        ))}
      </fieldset>
    </section>
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
        Parachute Notes is running as an installed app on this device.
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
