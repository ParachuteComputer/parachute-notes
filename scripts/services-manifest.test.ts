import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ServiceEntry,
  ServicesManifestError,
  readManifest,
  servicesManifestPath,
  upsertService,
} from "./services-manifest";

function tempPath(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pnotes-manifest-"));
  const path = join(dir, "services.json");
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const notes: ServiceEntry = {
  name: "parachute-notes",
  port: 5173,
  paths: ["/notes/"],
  health: "/notes/",
  version: "0.0.1",
  displayName: "Notes",
  tagline: "Web client for your Parachute Vault",
};

const vault: ServiceEntry = {
  name: "parachute-vault",
  port: 1940,
  paths: ["/"],
  health: "/health",
  version: "0.2.4",
};

describe("services-manifest", () => {
  it("readManifest returns empty when file missing", () => {
    const { path, cleanup } = tempPath();
    try {
      expect(readManifest(path)).toEqual({ services: [] });
    } finally {
      cleanup();
    }
  });

  it("upsertService creates the file if missing", () => {
    const { path, cleanup } = tempPath();
    try {
      const m = upsertService(notes, path);
      expect(m.services).toEqual([notes]);
      expect(readManifest(path)).toEqual({ services: [notes] });
    } finally {
      cleanup();
    }
  });

  it("upsertService updates by name and never duplicates", () => {
    const { path, cleanup } = tempPath();
    try {
      upsertService(notes, path);
      const updated = { ...notes, port: 4200, version: "0.1.0" };
      upsertService(updated, path);
      const m = readManifest(path);
      expect(m.services).toHaveLength(1);
      expect(m.services[0]).toEqual(updated);
    } finally {
      cleanup();
    }
  });

  it("upsertService preserves entries written by other services", () => {
    const { path, cleanup } = tempPath();
    try {
      writeFileSync(path, `${JSON.stringify({ services: [vault] }, null, 2)}\n`);
      upsertService(notes, path);
      const m = readManifest(path);
      expect(m.services).toHaveLength(2);
      expect(m.services.find((s) => s.name === "parachute-vault")).toEqual(vault);
      expect(m.services.find((s) => s.name === "parachute-notes")).toEqual(notes);
    } finally {
      cleanup();
    }
  });

  it("upsertService writes pretty-printed JSON with trailing newline", () => {
    const { path, cleanup } = tempPath();
    try {
      upsertService(notes, path);
      const raw = readFileSync(path, "utf8");
      expect(raw).toBe(`${JSON.stringify({ services: [notes] }, null, 2)}\n`);
    } finally {
      cleanup();
    }
  });

  it("readManifest throws ServicesManifestError on malformed JSON", () => {
    const { path, cleanup } = tempPath();
    try {
      writeFileSync(path, "{ not json");
      expect(() => readManifest(path)).toThrow(ServicesManifestError);
    } finally {
      cleanup();
    }
  });

  it("upsertService rejects an invalid entry without touching the file", () => {
    const { path, cleanup } = tempPath();
    try {
      writeFileSync(path, `${JSON.stringify({ services: [vault] }, null, 2)}\n`);
      const bad = { ...notes, port: -1 };
      expect(() => upsertService(bad as ServiceEntry, path)).toThrow(ServicesManifestError);
      expect(readManifest(path)).toEqual({ services: [vault] });
    } finally {
      cleanup();
    }
  });

  it("accepts entries without optional displayName and tagline (vault-style)", () => {
    const { path, cleanup } = tempPath();
    try {
      const m = upsertService(vault, path);
      expect(m.services[0]).toEqual(vault);
      expect(m.services[0]?.displayName).toBeUndefined();
      expect(m.services[0]?.tagline).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("rejects non-string displayName / tagline", () => {
    const { path, cleanup } = tempPath();
    try {
      const badDisplay = { ...notes, displayName: 42 } as unknown as ServiceEntry;
      expect(() => upsertService(badDisplay, path)).toThrow(/displayName/);
      const badTagline = { ...notes, tagline: 42 } as unknown as ServiceEntry;
      expect(() => upsertService(badTagline, path)).toThrow(/tagline/);
    } finally {
      cleanup();
    }
  });

  it("default path honors PARACHUTE_HOME set at runtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "pnotes-home-"));
    const prior = process.env.PARACHUTE_HOME;
    process.env.PARACHUTE_HOME = dir;
    try {
      expect(servicesManifestPath()).toBe(join(dir, "services.json"));
      upsertService(notes);
      expect(readManifest()).toEqual({ services: [notes] });
    } finally {
      // biome-ignore lint/performance/noDelete: process.env coerces assignments to strings; only delete actually unsets the key
      if (prior === undefined) delete process.env.PARACHUTE_HOME;
      else process.env.PARACHUTE_HOME = prior;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
