// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { VaultClient } from "./client";
import { NOTES_REQUIRED_SCHEMA } from "./schema";
import { auditSchema } from "./schema-audit";

function makeClient(rows: unknown[]): VaultClient {
  const fetchImpl = vi.fn(async () => {
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return new VaultClient({
    vaultUrl: "http://localhost:1940",
    accessToken: "tok_test",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

// Helper — every test starts with the canonical "ok" shape and then
// mutates one row to exercise the diff branches.
function okShape() {
  return NOTES_REQUIRED_SCHEMA.tags.map((decl) => ({
    name: decl.name,
    count: 0,
    description: decl.description,
    parent_names: decl.parent_names ?? null,
  }));
}

describe("auditSchema", () => {
  it("returns ok=true when every declared tag matches", async () => {
    const client = makeClient(okShape());
    const result = await auditSchema(client);
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.misaligned).toHaveLength(0);
    for (const row of result.rows) {
      expect(row.status).toBe("ok");
      expect(row.differences).toEqual([]);
    }
  });

  it("detects a missing tag", async () => {
    // Vault doesn't have `capture/voice` yet.
    const rows = okShape().filter((r) => r.name !== "capture/voice");
    const client = makeClient(rows);
    const result = await auditSchema(client);
    expect(result.ok).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]?.name).toBe("capture/voice");
    expect(result.misaligned).toHaveLength(0);
  });

  it("detects misaligned description", async () => {
    const rows = okShape();
    rows[0]!.description = "something else";
    const client = makeClient(rows);
    const result = await auditSchema(client);
    expect(result.ok).toBe(false);
    expect(result.misaligned).toHaveLength(1);
    expect(result.misaligned[0]?.name).toBe(rows[0]!.name);
    expect(result.misaligned[0]?.differences).toContain("description");
  });

  it("detects misaligned parent_names", async () => {
    const rows = okShape();
    // `capture/text` declares parent_names: ["capture"]. Mutate to wrong parent.
    const captureText = rows.find((r) => r.name === "capture/text")!;
    captureText.parent_names = ["note"];
    const client = makeClient(rows);
    const result = await auditSchema(client);
    expect(result.ok).toBe(false);
    expect(result.misaligned).toHaveLength(1);
    expect(result.misaligned[0]?.name).toBe("capture/text");
    expect(result.misaligned[0]?.differences).toContain("parent_names");
  });

  it("treats null and empty-array parent_names as equivalent for parent tags", async () => {
    // Parent `capture` declares no parent_names. Vault could store the
    // column as `null` OR `[]` — both mean "no parents". Both must pass.
    const rows = okShape();
    const capture = rows.find((r) => r.name === "capture")!;
    capture.parent_names = [];
    const client = makeClient(rows);
    const result = await auditSchema(client);
    expect(result.ok).toBe(true);
  });

  it("includes every declared tag in `rows` regardless of status", async () => {
    const rows = okShape().filter((r) => r.name !== "capture/voice");
    const client = makeClient(rows);
    const result = await auditSchema(client);
    expect(result.rows).toHaveLength(NOTES_REQUIRED_SCHEMA.tags.length);
    const names = result.rows.map((r) => r.name);
    for (const decl of NOTES_REQUIRED_SCHEMA.tags) {
      expect(names).toContain(decl.name);
    }
  });

  it("does not flag extra vault tags (user-owned tags are not audited)", async () => {
    // A vault that has the required schema PLUS the user's own tags
    // (e.g. "pinned", "voice" leftover from rc.6) must still come back ok.
    // Audit is narrow — surface-required only.
    const rows = [
      ...okShape(),
      { name: "pinned", count: 5, description: null, parent_names: null },
      { name: "voice", count: 3, description: null, parent_names: null },
    ];
    const client = makeClient(rows);
    const result = await auditSchema(client);
    expect(result.ok).toBe(true);
  });
});
