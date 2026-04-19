import { describe, expect, it, vi } from "vitest";
import { fetchParachuteJson, parseParachuteJson, pickVault } from "./parachute-json";

function mockFetch(
  responses: Array<{ ok?: boolean; status?: number; json?: unknown } | "network-error">,
) {
  const queue = [...responses];
  return vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected fetch call");
    if (next === "network-error") throw new Error("network down");
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: async () => next.json,
      text: async () => "",
    } as Response;
  });
}

describe("parseParachuteJson", () => {
  it("accepts the single-vault shape `{ vault: { url } }`", () => {
    const out = parseParachuteJson({ vault: { url: "https://h.example/vault/default" } });
    expect(out).toEqual({ vaults: [{ name: "default", url: "https://h.example/vault/default" }] });
  });

  it("accepts the multi-vault shape `{ vaults: [...] }`", () => {
    const out = parseParachuteJson({
      vaults: [
        { name: "default", url: "https://h.example/vault/default" },
        { name: "work", url: "https://h.example/vault/work" },
      ],
    });
    expect(out?.vaults).toHaveLength(2);
    expect(out?.vaults[1]?.name).toBe("work");
  });

  it("prefers `vaults` when both shapes are present", () => {
    const out = parseParachuteJson({
      vault: { url: "https://h.example/vault/default" },
      vaults: [{ name: "work", url: "https://h.example/vault/work" }],
    });
    expect(out?.vaults).toEqual([{ name: "work", url: "https://h.example/vault/work" }]);
  });

  it("fills in a fallback name when an entry has no name", () => {
    const out = parseParachuteJson({ vaults: [{ url: "https://h.example/vault/x" }] });
    expect(out?.vaults[0]?.name).toBe("default");
  });

  it("returns null on garbage input", () => {
    expect(parseParachuteJson(null)).toBeNull();
    expect(parseParachuteJson("nope")).toBeNull();
    expect(parseParachuteJson({ vaults: [] })).toBeNull();
    expect(parseParachuteJson({ vaults: [{ name: "x" }] })).toBeNull();
  });
});

describe("pickVault", () => {
  const sample = {
    vaults: [
      { name: "work", url: "https://h.example/vault/work" },
      { name: "default", url: "https://h.example/vault/default" },
    ],
  };

  it("prefers a vault matching the requested name", () => {
    expect(pickVault(sample, "work")?.name).toBe("work");
  });

  it("falls back to the entry named `default`", () => {
    expect(pickVault(sample)?.name).toBe("default");
  });

  it("falls back to the first entry when no `default` exists", () => {
    expect(pickVault({ vaults: [{ name: "work", url: "u" }] })?.name).toBe("work");
  });
});

describe("fetchParachuteJson", () => {
  it("hits the well-known path on the origin and parses the response", async () => {
    const fetchImpl = mockFetch([{ json: { vault: { url: "https://h.example/vault/default" } } }]);
    const out = await fetchParachuteJson("https://h.example/some/path", 500, fetchImpl);
    expect(out?.vaults[0]?.url).toBe("https://h.example/vault/default");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://h.example/.well-known/parachute.json",
      expect.any(Object),
    );
  });

  it("returns null on 404", async () => {
    const fetchImpl = mockFetch([{ ok: false, status: 404 }]);
    expect(await fetchParachuteJson("https://h.example", 500, fetchImpl)).toBeNull();
  });

  it("returns null on network error", async () => {
    const fetchImpl = mockFetch(["network-error"]);
    expect(await fetchParachuteJson("https://h.example", 500, fetchImpl)).toBeNull();
  });
});
