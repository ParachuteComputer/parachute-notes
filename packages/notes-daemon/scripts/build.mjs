#!/usr/bin/env node
// Build the notes-daemon publish target.
//
// `@openparachute/notes` (this package) and `@openparachute/notes-ui` ship the
// same SPA bundle — notes-ui is the canonical source-of-truth, notes-daemon
// is the module-shaped wrapper that hub installs via `parachute install notes`.
// Build = copy notes-ui's dist/ into our dist/, no transformation.
//
// We treat notes-ui's dist as a build-time artifact: the workspace dependency
// is resolved through node_modules. The pre-resolved path is what Vite + bun
// link to the actual UI source. If the UI hasn't been built yet, fail loudly
// so the operator can run `bun run build` from the workspace root.

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
