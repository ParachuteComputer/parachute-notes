import { useActiveVaultClient } from "@/lib/vault/queries";
import { useSchemaAuditStore } from "@/lib/vault/schema-audit-store";
import { useSchemaBannerStore } from "@/lib/vault/schema-banner-store";
import { fixSchema } from "@/lib/vault/schema-ensure";
import { useVaultStore } from "@/lib/vault/store";
import { useState } from "react";
import { Link } from "react-router";

// Connect-time banner for notes#129. Surfaces when the active vault's
// schema audit comes back `!ok` and the operator hasn't dismissed it.
//
// Renders BELOW `VaultStatusBanner` (auth-halt + unreachable) so the
// stack reads: critical-vault-down > auth-needs-reconnect > schema-
// out-of-date. Schema misalignment doesn't break capture (the per-
// capture ensure still runs), so it shouldn't block higher-priority
// recovery actions.
//
// Two affordances:
//   - "Set up" → calls `fixSchema` (the user-driven entry point in
//     schema-ensure.ts, which bypasses the per-session guard). On
//     success, re-audit + dismiss. On failure, log + leave banner up.
//   - "Dismiss" → persist per-vault to localStorage. The Settings panel
//     still surfaces the audit state for the operator who wants to
//     return to it later.

export function SchemaAuditBanner() {
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const audit = useSchemaAuditStore((s) =>
    activeVaultId ? (s.byVault[activeVaultId] ?? null) : null,
  );
  const setAudit = useSchemaAuditStore((s) => s.set);
  const dismissed = useSchemaBannerStore((s) =>
    activeVaultId ? !!s.dismissedByVault[activeVaultId] : false,
  );
  const dismiss = useSchemaBannerStore((s) => s.dismiss);
  const client = useActiveVaultClient();
  const [fixing, setFixing] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);

  // Render conditions — keep the banner out of the DOM whenever
  // possible so screen readers don't get a brief flash before the
  // audit lands.
  if (!activeVaultId) return null;
  if (!audit?.result) return null; // No audit yet — wait for it.
  if (audit.result.ok) return null;
  if (dismissed) return null;

  const missingCount = audit.result.missing.length;
  const misalignedCount = audit.result.misaligned.length;

  async function onSetUp() {
    if (!client || !activeVaultId) return;
    setFixing(true);
    setFixError(null);
    try {
      await fixSchema(activeVaultId, client);
      // Replace the cached audit with a known-ok result instead of
      // re-fetching — the fix wrote every declared row, so we know the
      // shape now. Saves a round-trip; the Settings panel's "Refresh"
      // button is the explicit re-verify if the operator wants it.
      setAudit(activeVaultId, {
        ok: true,
        missing: [],
        misaligned: [],
        rows: audit?.result?.rows.map((r) => ({ ...r, status: "ok", differences: [] })) ?? [],
      });
    } catch (err) {
      setFixError(err instanceof Error ? err.message : String(err));
    } finally {
      setFixing(false);
    }
  }

  return (
    // <output> carries an implicit `role="status"` (Biome's preferred form
    // over `<div role="status">`) and aria-live="polite". `RouteFallback`
    // uses the same shape — see App.tsx.
    <output
      aria-live="polite"
      className="block border-b border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200 md:px-6"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-medium text-amber-100">Vault schema needs setup</p>
          <p className="text-xs text-amber-200/80">
            {missingCount > 0 && misalignedCount > 0
              ? `${missingCount} missing, ${misalignedCount} misaligned`
              : missingCount > 0
                ? `${missingCount} missing tag${missingCount === 1 ? "" : "s"} Notes uses`
                : `${misalignedCount} tag${misalignedCount === 1 ? "" : "s"} need realignment`}{" "}
            (capture / capture/text / capture/voice).{" "}
            <Link to="/settings" className="underline hover:text-amber-100">
              Review in Settings
            </Link>
            .
          </p>
          {fixError ? <p className="mt-1 text-xs text-red-300">{fixError}</p> : null}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void onSetUp()}
            disabled={fixing || !client}
            className="min-h-11 self-start rounded-md bg-amber-500/30 px-3 py-1.5 text-xs font-medium text-amber-50 hover:bg-amber-500/50 disabled:cursor-not-allowed disabled:opacity-60 md:self-auto"
          >
            {fixing ? "Setting up…" : "Set up"}
          </button>
          <button
            type="button"
            onClick={() => dismiss(activeVaultId)}
            className="min-h-11 self-start rounded-md px-3 py-1.5 text-xs text-amber-200/80 hover:text-amber-100 md:self-auto"
            aria-label="Dismiss schema setup banner"
          >
            Dismiss
          </button>
        </div>
      </div>
    </output>
  );
}
