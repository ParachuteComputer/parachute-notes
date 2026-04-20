import type { Plugin, PreviewServer, ViteDevServer } from "vite";

// `kind` tells the hub how to present the card: `frontend` is clickable
// (opens the UI), `api` shows an inline detail panel (click-through is a raw
// JSON response, not useful for humans), `tool` is a CLI-only or headless
// service. See DESIGN-2026-04-20-hub-as-portal-oauth-and-service-catalog.md.
export type ServiceKind = "frontend" | "api" | "tool";

export interface ServiceInfo {
  name: string;
  displayName: string;
  tagline: string;
  version: string;
  iconUrl: string;
  kind: ServiceKind;
}

interface PluginOptions extends ServiceInfo {
  basePath: string;
}

const ENDPOINT = ".parachute/info.json";

// Synthesize the `/.parachute/info.json` endpoint that the hub page reads to
// render service cards. We don't commit a placeholder file in `public/`
// because `version` has to come from `package.json` at build time — keeping
// it dynamic avoids drift between the package version and the served value.
export function infoEndpointPlugin(options: PluginOptions): Plugin {
  const { basePath, ...info } = options;
  const body = `${JSON.stringify(info satisfies ServiceInfo, null, 2)}\n`;
  const baseWithSlash = basePath.endsWith("/") ? basePath : `${basePath}/`;
  const servePath = `${baseWithSlash}${ENDPOINT}`;

  function attach(server: ViteDevServer | PreviewServer): void {
    server.middlewares.use(servePath, (_req, res) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.end(body);
    });
  }

  return {
    name: "parachute-notes-info-endpoint",
    configureServer: attach,
    configurePreviewServer: attach,
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: ENDPOINT,
        source: body,
      });
    },
  };
}

export function buildServiceInfo(args: {
  name: string;
  displayName: string;
  tagline: string;
  version: string;
  basePath: string;
  iconFile: string;
  kind: ServiceKind;
}): ServiceInfo {
  const baseWithSlash = args.basePath.endsWith("/") ? args.basePath : `${args.basePath}/`;
  const icon = args.iconFile.startsWith("/") ? args.iconFile.slice(1) : args.iconFile;
  return {
    name: args.name,
    displayName: args.displayName,
    tagline: args.tagline,
    version: args.version,
    iconUrl: `${baseWithSlash}${icon}`,
    kind: args.kind,
  };
}
