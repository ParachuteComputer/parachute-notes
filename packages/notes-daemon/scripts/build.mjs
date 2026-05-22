#!/usr/bin/env node
// Build the notes-daemon publish target.
//
// `@openparachute/notes` (this package) and `@openparachute/notes-ui` ship the
// same SPA bundle — notes-ui is the canonical source-of-truth, notes-daemon
// is the module-shaped wrapper that hub installs via `parachute install notes`.
// Build = copy notes-ui's dist/ into our dist/, no transformation.
//
// We resolve notes-ui's dist/ via a relative workspace path (../notes-ui/dist).
// This is a monorepo-local convention — there's no @openparachute/notes-ui
// symlink in node_modules; the path walks straight to the sibling package.
// When the daemon is published independently (or notes-ui retires per Phase 3),
// dist/ is copied at build time and the relative resolution drops away.
// If the UI hasn't been built yet, fail loudly so the operator can run
// `bun run build` from the workspace root.

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const daemonRoot = resolve(__dirname, "..");
const uiDist = resolve(daemonRoot, "..", "notes-ui", "dist");
const daemonDist = resolve(daemonRoot, "dist");

if (!existsSync(uiDist)) {
  console.error(
    `notes-daemon build: notes-ui dist/ not found at ${uiDist}.\n` +
      `Run \`bun --cwd packages/notes-ui run build\` (or the workspace-root \`bun run build\`) first.`,
  );
  process.exit(1);
}

console.log(`notes-daemon: copying ${uiDist} -> ${daemonDist}`);
rmSync(daemonDist, { recursive: true, force: true });
mkdirSync(daemonDist, { recursive: true });
cpSync(uiDist, daemonDist, { recursive: true });

console.log("notes-daemon: build complete.");
