#!/usr/bin/env node
// Smoke test for the notes-daemon build target.
//
// notes-daemon's publish payload is `dist/` + `.parachute/module.json`. If
// `dist/` exists (i.e. someone ran `bun run build` first), assert it has the
// shape hub expects when serving the bundle: index.html at the root, an
// `assets/` directory with bundled JS, and the `.parachute/info` endpoint that
// info-endpoint-plugin emits.
//
// If dist/ does not exist, exit cleanly — `bun test` (without a prior build)
// should not fail; the test is "if you built, the build is valid."
//
// This is intentionally a Node script rather than a vitest run: the daemon
// package has no Vite/Vitest deps. Keeping it lean means notes-daemon stays a
// pure bundle-shipper with no dev-tool footprint.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const daemonRoot = resolve(__dirname, "..");
const dist = resolve(daemonRoot, "dist");
const moduleJson = resolve(daemonRoot, ".parachute", "module.json");

const failures = [];

function check(condition, label) {
  if (!condition) failures.push(label);
  process.stdout.write(`  ${condition ? "ok" : "FAIL"} - ${label}\n`);
}

console.log("notes-daemon smoke tests");

// .parachute/module.json must always be present (it's checked into the repo).
check(existsSync(moduleJson), ".parachute/module.json exists");
if (existsSync(moduleJson)) {
  try {
    const parsed = JSON.parse(readFileSync(moduleJson, "utf8"));
    check(parsed.name === "notes", "module.json name=notes");
    check(parsed.kind === "frontend", "module.json kind=frontend");
    check(parsed.port === 1942, "module.json port=1942");
  } catch (e) {
    failures.push(`module.json parse: ${e.message}`);
  }
}

// dist/ is only checked when present — the build-not-yet-run case is fine.
if (!existsSync(dist)) {
  console.log("  (dist/ not built yet — skipping dist shape checks)");
} else {
  check(statSync(dist).isDirectory(), "dist/ is a directory");
  check(existsSync(resolve(dist, "index.html")), "dist/index.html exists");
  check(existsSync(resolve(dist, "assets")), "dist/assets/ exists");
  if (existsSync(resolve(dist, "assets"))) {
    const assets = readdirSync(resolve(dist, "assets"));
    check(
      assets.some((f) => f.endsWith(".js")),
      "dist/assets contains at least one .js bundle",
    );
    check(
      assets.some((f) => f.endsWith(".css")),
      "dist/assets contains at least one .css bundle",
    );
  }
  // The info-endpoint-plugin emits this file at the path the hub probes.
  // Notes-daemon ships under /notes/ — the info endpoint is at /.parachute/info
  // relative to dist root (and Vite also emits a basePath-prefixed copy).
  check(
    existsSync(resolve(dist, ".parachute", "info")),
    "dist/.parachute/info exists (info-endpoint-plugin output)",
  );
}

if (failures.length > 0) {
  console.error(`\nnotes-daemon smoke tests FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nnotes-daemon smoke tests passed.");
