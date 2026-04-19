import type { AddressInfo } from "node:net";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import {
  type ServiceEntry,
  ServicesManifestError,
  servicesManifestPath,
  upsertService,
} from "./services-manifest";

interface PluginOptions {
  name: string;
  version: string;
  basePath: string;
}

// Notes is an SPA — no long-running Node entrypoint that would otherwise own
// the manifest write. Hook the Vite dev + preview servers instead so the
// manifest reflects the actual listening port. We deliberately do NOT write
// during `vite build` (no port to advertise; the CLI's expose tool registers
// the served bundle).
//
// Best-effort: a manifest write failure (PARACHUTE_HOME unwritable, schema
// drift, malformed pre-existing file) only logs a warning. Don't break dev.
export function notesServicePlugin(options: PluginOptions): Plugin {
  const { name, version, basePath } = options;
  const healthPath = basePath.endsWith("/") ? basePath : `${basePath}/`;

  function writeEntry(port: number): void {
    const entry: ServiceEntry = {
      name,
      port,
      paths: [healthPath],
      health: healthPath,
      version,
    };
    try {
      upsertService(entry);
    } catch (err) {
      const msg = err instanceof ServicesManifestError ? err.message : String(err);
      console.log(`  Warning: could not update ${servicesManifestPath()}: ${msg}`);
    }
  }

  function attach(server: ViteDevServer | PreviewServer): void {
    server.httpServer?.once("listening", () => {
      const address = server.httpServer?.address();
      const port = typeof address === "object" && address ? (address as AddressInfo).port : null;
      if (port) writeEntry(port);
    });
  }

  return {
    name: "parachute-notes-service-manifest",
    apply: (_config, env) => env.command === "serve",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
