// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VaultClient } from "./client";
import { NOTES_REQUIRED_SCHEMA } from "./schema";
import { _resetEnsuredVaultsForTesting, ensureNotesSchema, fixSchema } from "./schema-ensure";

function makeClient(fetchImpl: ReturnType<typeof vi.fn>): VaultClient {
  return new VaultClient({
    vaultUrl: "http://localhost:1940",
    accessToken: "tok_test",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

describe("ensureNotesSchema", () => {
  beforeEach(() => {
    _resetEnsuredVaultsForTesting();
  });
  afterEach(() => {
    _resetEnsuredVaultsForTesting();
  });

  it("PUTs each required tag in declaration order", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      return new Response(null, { status: 204 });
    });
    const client = makeClient(fetchImpl);

    await ensureNotesSchema("v1", client);

    // One call per declared tag, same order as NOTES_REQUIRED_SCHEMA.tags.
    expect(calls).toHaveLength(NOTES_REQUIRED_SCHEMA.tags.length);
    for (let i = 0; i < NOTES_REQUIRED_SCHEMA.tags.length; i++) {
      const decl = NOTES_REQUIRED_SCHEMA.tags[i]!;
      const call = calls[i]!;
      expect(call.url).toBe(`http://localhost:1940/api/tags/${encodeURIComponent(decl.name)}`);
      expect(call.body).toMatchObject({ description: decl.description });
      if (decl.parent_names) {
        expect(call.body).toMatchObject({ parent_names: decl.parent_names });
      } else {
        // Parent rows omit parent_names from the payload.
        expect(call.body).not.toHaveProperty("parent_names");
      }
    }
  });

  it("ensures the `capture` parent BEFORE its children", async () => {
    const order: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      const match = (url as string).match(/\/api\/tags\/(.+)$/);
      if (match) order.push(decodeURIComponent(match[1]!));
      return new Response(null, { status: 204 });
    });
    await ensureNotesSchema("v1", makeClient(fetchImpl));

    expect(order[0]).toBe("capture");
    expect(order.indexOf("capture")).toBeLessThan(order.indexOf("capture/text"));
    expect(order.indexOf("capture")).toBeLessThan(order.indexOf("capture/voice"));
  });

  it("is idempotent per-session per-vault (second call within session is a no-op)", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const client = makeClient(fetchImpl);

    await ensureNotesSchema("v1", client);
    const callsAfterFirst = fetchImpl.mock.calls.length;
    expect(callsAfterFirst).toBe(NOTES_REQUIRED_SCHEMA.tags.length);

    // Same vault, same session — guard should block all repeat calls.
    await ensureNotesSchema("v1", client);
    expect(fetchImpl.mock.calls.length).toBe(callsAfterFirst);
  });

  it("tracks vaults independently — ensures per-vault separately", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const client = makeClient(fetchImpl);

    await ensureNotesSchema("v1", client);
    await ensureNotesSchema("v2", client);

    // 2 vaults × N tags each.
    expect(fetchImpl.mock.calls.length).toBe(NOTES_REQUIRED_SCHEMA.tags.length * 2);
  });

  it("rolls back the guard on failure so the next call can retry", async () => {
    let fail = true;
    const fetchImpl = vi.fn(async () => {
      if (fail) return new Response("boom", { status: 500 });
      return new Response(null, { status: 204 });
    });
    const client = makeClient(fetchImpl);

    // Suppress the warn so the test output stays clean.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await ensureNotesSchema("v1", client);
    // First call fired ONE PUT (the parent), then 500'd → no further calls.
    expect(fetchImpl.mock.calls.length).toBe(1);

    // Flip success, retry — guard should let us through.
    fail = false;
    await ensureNotesSchema("v1", client);
    // Full sweep this time.
    expect(fetchImpl.mock.calls.length).toBe(1 + NOTES_REQUIRED_SCHEMA.tags.length);

    warnSpy.mockRestore();
  });

  it("swallows failures (does not throw to caller)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network down");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(ensureNotesSchema("v1", makeClient(fetchImpl))).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe("fixSchema (notes#129 user-driven path)", () => {
  beforeEach(() => {
    _resetEnsuredVaultsForTesting();
  });
  afterEach(() => {
    _resetEnsuredVaultsForTesting();
  });

  it("PUTs every declared tag (bypasses the per-session guard)", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const client = makeClient(fetchImpl);

    // First, ensure once — the session guard marks v1 as ensured.
    await ensureNotesSchema("v1", client);
    const callsAfterEnsure = fetchImpl.mock.calls.length;
    expect(callsAfterEnsure).toBe(NOTES_REQUIRED_SCHEMA.tags.length);

    // ensureNotesSchema would skip. fixSchema must not.
    await fixSchema("v1", client);
    expect(fetchImpl.mock.calls.length).toBe(callsAfterEnsure + NOTES_REQUIRED_SCHEMA.tags.length);
  });

  it("rethrows on failure (unlike ensureNotesSchema which swallows)", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 }));
    const client = makeClient(fetchImpl);

    await expect(fixSchema("v1", client)).rejects.toBeDefined();
  });

  it("marks the vault as ensured after success — next ensure call is a no-op", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const client = makeClient(fetchImpl);

    await fixSchema("v1", client);
    const callsAfterFix = fetchImpl.mock.calls.length;

    await ensureNotesSchema("v1", client);
    expect(fetchImpl.mock.calls.length).toBe(callsAfterFix);
  });
});
