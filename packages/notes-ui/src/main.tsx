import { App } from "@/app/App";
import { cleanupStaleServiceWorker } from "@/lib/sw-bootstrap";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

// Fire-and-forget: unregister any stale `/notes/`-scoped service worker
// left behind by a pre-0.1.2 install when the bundle is now being served
// at a different mount (e.g. `/app/notes/`). Without this, operators
// upgrading via parachute-app keep hitting workbox's
// `non-precached-url :: /notes/index.html` + "Expected JavaScript-or-Wasm
// module, got text/html" errors until they manually unregister the SW
// from DevTools. See `lib/sw-bootstrap.ts` for the full rationale.
cleanupStaleServiceWorker().catch(() => {
  // Best-effort cleanup — never block app boot. The fresh registration
  // gate in `UpdateBanner` is the load-bearing path; this is the legacy-
  // operator recovery affordance.
});

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
