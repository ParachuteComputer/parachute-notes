import { describe, expect, it } from "vitest";
import { type ServiceInfo, buildServiceInfo, infoEndpointPlugin } from "./info-endpoint-plugin";

const exampleInfo: ServiceInfo = {
  name: "parachute-notes",
  displayName: "Notes",
  tagline: "Web client for your Parachute Vault",
  version: "0.0.1",
  iconUrl: "/notes/icon.svg",
};

describe("buildServiceInfo", () => {
  it("threads basePath into iconUrl", () => {
    const info = buildServiceInfo({
      name: "parachute-notes",
      displayName: "Notes",
      tagline: "Web client for your Parachute Vault",
      version: "0.0.1",
      basePath: "/notes",
      iconFile: "icon.svg",
    });
    expect(info.iconUrl).toBe("/notes/icon.svg");
  });

  it("normalizes a trailing slash and strips a leading icon slash", () => {
    const info = buildServiceInfo({
      name: "x",
      displayName: "X",
      tagline: "t",
      version: "1",
      basePath: "/notes/",
      iconFile: "/icon.svg",
    });
    expect(info.iconUrl).toBe("/notes/icon.svg");
  });
});

describe("infoEndpointPlugin", () => {
  it("emits .parachute/info.json into the bundle on build", () => {
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
    expect(emitted[0]?.fileName).toBe(".parachute/info.json");
    const parsed = JSON.parse(String(emitted[0]?.source));
    expect(parsed).toEqual(exampleInfo);
  });

  it("serves the same JSON via dev server middleware at basePath/.parachute/info.json", () => {
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

    expect(uses).toHaveLength(1);
    expect(uses[0]?.path).toBe("/notes/.parachute/info.json");

    const res = new MockRes();
    uses[0]?.handler({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toMatch(/application\/json/);
    expect(JSON.parse(res.body)).toEqual(exampleInfo);
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
