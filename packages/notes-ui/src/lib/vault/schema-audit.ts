import type { VaultClient } from "./client";
import { NOTES_REQUIRED_SCHEMA, type RequiredTagDecl } from "./schema";

// Audit helper for notes#129 — compare the vault's current tag schema
// against `NOTES_REQUIRED_SCHEMA` and return a structured diff. Powers
// the Settings panel (per-tag rows + one-click fix) AND the connect-time
// banner. Idempotent + side-effect free — the fix path goes through
// `ensureNotesSchema()` (which re-uses the audit's misaligned set).
//
// Distinguished from `schema-ensure.ts` so this module can be imported
// without dragging in the per-session ref guard. The audit is read-only;
// ensure is a write.

// One tag row from `GET /api/tags?include_schema=true`. Notes only needs
// the identity fields the audit compares against — `description` and
// `parent_names`. The vault returns more (`fields`, `relationships`,
// `created_at`, etc.) but they're not part of `NOTES_REQUIRED_SCHEMA`.
export interface TagSchemaRow {
  name: string;
  count?: number;
  description?: string | null;
  parent_names?: string[] | null;
}

// Per-tag audit verdict. `missing` if the vault has no row for the
// declared name; `misaligned` if the row exists but doesn't match the
// expected description/parent_names; `ok` otherwise.
export type TagAuditStatus = "missing" | "misaligned" | "ok";

export interface TagAuditRow {
  name: string;
  status: TagAuditStatus;
  expected: RequiredTagDecl;
  // `null` when missing; the vault row otherwise. UI shows expected-vs-
  // actual side by side for misaligned.
  actual: TagSchemaRow | null;
  // Concrete fields that differ. Empty for `ok` and `missing` (everything
  // is a difference when missing — the UI shows expected only).
  differences: ("description" | "parent_names")[];
}

export interface SchemaAuditResult {
  // True when every declared tag has status `ok`. The UI surfaces this
  // as the green-or-yellow status indicator.
  ok: boolean;
  // Pre-split for cheap rendering — UI groups by status anyway.
  missing: TagAuditRow[];
  misaligned: TagAuditRow[];
  rows: TagAuditRow[];
}

// String[] equality with null/undefined normalization. `parent_names: null`
// from vault means "no parents"; `[]` means same thing. Schema declares
// either `["capture"]` or nothing — normalize both sides before compare.
function parentNamesEqual(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  const av = a ?? [];
  const bv = b ?? [];
  if (av.length !== bv.length) return false;
  // Order matters semantically (the vault stores them as an array) but
  // both Notes and any same-pattern client emit them in the order the
  // schema declares. If we ever support multiple parents and ordering
  // becomes meaningful, this assertion stands.
  for (let i = 0; i < av.length; i++) {
    if (av[i] !== bv[i]) return false;
  }
  return true;
}

function diffOne(decl: RequiredTagDecl, row: TagSchemaRow | undefined): TagAuditRow {
  if (!row) {
    return {
      name: decl.name,
      status: "missing",
      expected: decl,
      actual: null,
      differences: [],
    };
  }
  const differences: ("description" | "parent_names")[] = [];
  if ((row.description ?? "") !== decl.description) differences.push("description");
  const expectedParents = decl.parent_names ?? null;
  if (!parentNamesEqual(row.parent_names, expectedParents)) differences.push("parent_names");
  return {
    name: decl.name,
    status: differences.length === 0 ? "ok" : "misaligned",
    expected: decl,
    actual: row,
    differences,
  };
}

// Fetches the vault's tag schema and diffs against `NOTES_REQUIRED_SCHEMA`.
// Network failures bubble — callers decide whether to retry / surface in
// UI. The Settings panel renders an error state; the connect-time banner
// silently skips (no banner is better than a misleading one).
export async function auditSchema(client: VaultClient): Promise<SchemaAuditResult> {
  const rows = await client.listTagsWithSchema();
  const byName = new Map(rows.map((r) => [r.name, r] as const));
  const audited = NOTES_REQUIRED_SCHEMA.tags.map((decl) => diffOne(decl, byName.get(decl.name)));
  const missing = audited.filter((r) => r.status === "missing");
  const misaligned = audited.filter((r) => r.status === "misaligned");
  return {
    ok: missing.length === 0 && misaligned.length === 0,
    missing,
    misaligned,
    rows: audited,
  };
}
