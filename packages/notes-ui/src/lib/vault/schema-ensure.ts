import type { VaultClient } from "./client";
import { NOTES_REQUIRED_SCHEMA } from "./schema";

// Per-session ref guard so we don't hammer the vault on every capture. The
// `update-tag` calls are idempotent (already-correct rows are no-op writes
// vault-side), but there's no point making the network round-trip if we
// already ensured this vault's schema in this session.
//
// Module-level Set rather than a hook because the call sites
// (Capture's save) are short-lived components and we want the guard to
// survive remount. localStorage was the alternative but it has the
// "delete localStorage = re-run forever" failure mode the team-lead
// flagged — refs in a module are the right scope: ephemeral, but
// session-stable.
const ensuredVaults = new Set<string>();

// Surface schema-ensure entry point. Fires the `update-tag` calls for the
// declared schema (NOTES_REQUIRED_SCHEMA) against the given vault.
// Idempotent: subsequent calls per (vault, session) are skipped via the
// module-level guard. First-call failures are logged but not rethrown —
// schema-ensure is plumbing, not a user-actionable surface; the next
// capture will retry. If the user needs visibility into schema state,
// notes#129 will add the audit UI.
export async function ensureNotesSchema(vaultId: string, client: VaultClient): Promise<void> {
  if (ensuredVaults.has(vaultId)) return;
  // Mark as ensured BEFORE the async calls so concurrent invocations don't
  // race into a double-fire (Capture's save can run in parallel via the
  // 5s autosave + manual click in the same tick).
  ensuredVaults.add(vaultId);
  try {
    // Sequential rather than Promise.all — vault writes the parent first
    // so children can resolve `parent_names`. The vault's PUT is permissive
    // about ordering (children can reference yet-to-exist parents), but
    // keeping the order matches the conceptual model + makes failure modes
    // clearer in logs.
    for (const decl of NOTES_REQUIRED_SCHEMA.tags) {
      await client.updateTag(decl.name, {
        description: decl.description,
        ...(decl.parent_names ? { parent_names: decl.parent_names } : {}),
      });
    }
  } catch (err) {
    // Roll back the guard so a future capture can retry. Schema-ensure is
    // best-effort; a transient 5xx shouldn't permanently disable it for the
    // session.
    ensuredVaults.delete(vaultId);
    // Don't rethrow — the capture itself still succeeds without the schema
    // setup. Log for debugging; notes#129 will surface this in the audit UI.
    if (typeof console !== "undefined") {
      console.warn(`[schema-ensure] failed to ensure required schema for vault ${vaultId}:`, err);
    }
  }
}

// User-driven fix path (notes#129). Always runs the full sweep — bypasses
// the per-session guard, because the user is explicitly asking us to ensure
// the schema (Settings panel button or connect-time banner action). Marks
// the vault as ensured on success so subsequent first-captures don't redo
// the work. Throws on failure so the UI can show "fix failed" rather than
// silently swallowing (unlike `ensureNotesSchema` which is fire-and-forget
// from capture's save path).
export async function fixSchema(vaultId: string, client: VaultClient): Promise<void> {
  for (const decl of NOTES_REQUIRED_SCHEMA.tags) {
    await client.updateTag(decl.name, {
      description: decl.description,
      ...(decl.parent_names ? { parent_names: decl.parent_names } : {}),
    });
  }
  // Fix succeeded → in-session "we ensured this vault" is now true. Skip
  // re-running on the next capture.
  ensuredVaults.add(vaultId);
}

// Test-only escape hatch — resets the in-session guard so a test can
// exercise the ensure-once behavior across multiple captures without
// reloading the module.
export function _resetEnsuredVaultsForTesting(): void {
  ensuredVaults.clear();
}
