import { describe, expect, it } from "vitest";
import { type ServiceInfo, buildServiceInfo, infoEndpointPlugin } from "./info-endpoint-plugin";

const exampleInfo: ServiceInfo = {
  name: "parachute-notes",
  displayName: "Notes",
  tagline: "Web client for your Parachute Vault",
  version: "0.0.1",
  iconUrl: "/notes/icon.svg",
  kind: "frontend",
};

describe("buildServiceInfo", () => {
  it("threads basePath into iconUrl and carries kind through", () => {
    const info = buildServiceInfo({
      name: "parachute-notes",
      displayName: "Notes",
      tagline: "Web client for your Parachute Vault",
      version: "0.0.1",
      basePath: "/notes",
      iconFile: "icon.svg",
      kind: "frontend",
    });
    expect(info.iconUrl).toBe("/notes/icon.svg");
    expect(info.kind).toBe("frontend");
  });

  it("normalizes a trailing slash and strips a leading icon slash", () => {
    const info = buildServiceInfo({
      name: "x",
      displayName: "X",
      tagline: "t",
      version: "1",
      basePath: "/notes/",
      iconFile: "/icon.svg",
      kind: "frontend",
    });
    expect(info.iconUrl).toBe("/notes/icon.svg");
  });

  it("accepts alternate kinds for non-frontend services", () => {
    const api = buildServiceInfo({
      name: "parachute-vault",
      displayName: "Vault",
      tagline: "Memory",
      version: "1",
      basePath: "/vault/default",
      iconFile: "icon.svg",
      kind: "api",
    });
    expect(api.kind).toBe("api");
  });
});

describe("infoEndpointPlugin", () => {
  it("emits .parachute/info into the bundle on build (no .json — matches hub's discovery contract)", () => {
    const plugin = infoEndpointPlugin({ basePath: "/notes", ...exampleInfo });
    const emitted: Array<{ type: string; fileName?: string; source?: string | Uint8Array }> = [];
    const ctx = {
      emitFile(file: { type: string; fileName?: string; source?: string | Uint8Array }) {
        emitted.push(file);
      },
    };
    const handler = plugin.generateBundle;
    if (typeof handler !== "function") throw new Error("generateBundle missing");
    handler.call(
      ctx as unknown as ThisParameterType<typeof handler>,
      // biome-ignore lint/suspicious/noExplicitAny: rollup options object isn't worth typing for a smoke test
      {} as any,
      // biome-ignore lint/suspicious/noExplicitAny: same
      {} as any,
      true,
    );
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.fileName).toBe(".parachute/info");
    const parsed = JSON.parse(String(emitted[0]?.source));
    expect(parsed).toEqual(exampleInfo);
  });

  it("registers middleware at both /notes/.parachute/info and root /.parachute/info — beats the SPA catch-all that would otherwise serve index.html", () => {
    const plugin = infoEndpointPlugin({ basePath: "/notes", ...exampleInfo });
    const uses: Array<{ path: string; handler: (req: unknown, res: MockRes) => void }> = [];
    const fakeServer = {
      middlewares: {
        use(path: string, handler: (req: unknown, res: MockRes) => void) {
          uses.push({ path, handler });
        },
      },
      httpServer: null,
    };
    const configure = plugin.configureServer;
    if (typeof configure !== "function") throw new Error("configureServer missing");
    // biome-ignore lint/suspicious/noExplicitAny: ViteDevServer surface isn't worth typing for a smoke test
    configure.call(plugin as any, fakeServer as any);

    expect(uses.map((u) => u.path).sort()).toEqual(["/.parachute/info", "/notes/.parachute/info"]);

    for (const use of uses) {
      const res = new MockRes();
      use.handler({}, res);
      expect(res.statusCode).toBe(200);
      expect(res.headers["Content-Type"]).toMatch(/application\/json/);
      expect(JSON.parse(res.body)).toEqual(exampleInfo);
    }
  });

  it("response shape matches the hub discovery contract — name, displayName, tagline, version, kind", () => {
    const plugin = infoEndpointPlugin({ basePath: "/notes", ...exampleInfo });
    const captured: { path: string; handler: (req: unknown, res: MockRes) => void }[] = [];
    const fakeServer = {
      middlewares: {
        use(path: string, handler: (req: unknown, res: MockRes) => void) {
          captured.push({ path, handler });
        },
      },
      httpServer: null,
    };
    const configurePreview = plugin.configurePreviewServer;
    if (typeof configurePreview !== "function") throw new Error("configurePreviewServer missing");
    // biome-ignore lint/suspicious/noExplicitAny: PreviewServer surface isn't worth typing for a smoke test
    configurePreview.call(plugin as any, fakeServer as any);
    const rooted = captured.find((u) => u.path === "/.parachute/info");
    if (!rooted) throw new Error("expected root middleware to be registered");

    const res = new MockRes();
    rooted.handler({}, res);
    const parsed = JSON.parse(res.body);
    expect(parsed.name).toBe("parachute-notes");
    expect(parsed.displayName).toBe("Notes");
    expect(parsed.tagline).toBeTypeOf("string");
    expect(parsed.version).toBeTypeOf("string");
    expect(parsed.kind).toBe("frontend");
  });
});

class MockRes {
  statusCode = 0;
  headers: Record<string, string> = {};
  body = "";
  setHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  end(chunk: string) {
    this.body = chunk;
  }
}
