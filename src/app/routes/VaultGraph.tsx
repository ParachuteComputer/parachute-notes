import {
  EMPTY_FILTER,
  type VaultGraphFilter,
  type VaultGraphNode,
  type VaultGraph as VaultGraphType,
  buildVaultGraph,
  collectTopTags,
  matchesFilter,
  tagColor,
  useAllNotesWithLinks,
  useVaultStore,
} from "@/lib/vault";
import { VaultAuthError } from "@/lib/vault/client";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";

const ForceGraph2D = lazy(() => import("react-force-graph-2d"));

const MAX_TAG_CHIPS = 20;

export function VaultGraph() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const query = useAllNotesWithLinks();
  const [filter, setFilter] = useState<VaultGraphFilter>(EMPTY_FILTER);

  const graph = useMemo(() => (query.data ? buildVaultGraph(query.data) : null), [query.data]);
  const allTags = useMemo(() => (graph ? collectTopTags(graph.nodes) : []), [graph]);
  const matched = useMemo(() => {
    if (!graph) return new Set<string>();
    return new Set(graph.nodes.filter((n) => matchesFilter(n, filter)).map((n) => n.id));
  }, [graph, filter]);

  if (!activeVault) return <Navigate to="/" replace />;

  return (
    <div className="flex h-[calc(100dvh-5rem)] flex-col">
      <div className="border-b border-border bg-card/40 px-6 py-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4">
          <input
            type="search"
            value={filter.search}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search nodes…"
            aria-label="Search graph nodes"
            className="min-w-48 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
          />
          <TagFilter
            allTags={allTags}
            selected={filter.tags}
            onChange={(tags) => setFilter((f) => ({ ...f, tags }))}
          />
          {graph ? (
            <span className="text-xs text-fg-dim">
              {matched.size} / {graph.nodes.length} notes
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <Body query={query} graph={graph} matched={matched} />
      </div>
    </div>
  );
}

function Body({
  query,
  graph,
  matched,
}: {
  query: ReturnType<typeof useAllNotesWithLinks>;
  graph: VaultGraphType | null;
  matched: Set<string>;
}) {
  if (query.isPending) return <GraphSkeleton message="Loading vault…" />;
  if (query.isError) {
    return <ErrorBlock error={query.error} />;
  }
  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <div className="max-w-sm rounded-md border border-border bg-card p-8 text-center">
          <p className="mb-2 font-serif text-xl">No notes yet</p>
          <p className="mb-4 text-sm text-fg-muted">
            This vault is empty. Start by creating the first note.
          </p>
          <Link
            to="/new"
            className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Create a note
          </Link>
        </div>
      </div>
    );
  }
  return <GraphCanvas graph={graph} matched={matched} />;
}

function TagFilter({
  allTags,
  selected,
  onChange,
}: {
  allTags: string[];
  selected: string[];
  onChange: (tags: string[]) => void;
}) {
  const visible = allTags.slice(0, MAX_TAG_CHIPS);
  if (visible.length === 0) return null;
  const toggle = (t: string) =>
    onChange(selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t]);
  return (
    <fieldset
      aria-label="Filter by tag"
      className="flex flex-wrap items-center gap-1 text-xs text-fg-dim"
    >
      <legend className="mr-1 inline-block">Tags</legend>
      {visible.map((t) => {
        const active = selected.includes(t);
        return (
          <button
            key={t}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(t)}
            className={
              active
                ? "rounded-full border border-accent bg-accent/10 px-2 py-0.5 text-accent"
                : "rounded-full border border-border bg-card px-2 py-0.5 hover:text-accent"
            }
          >
            {t}
          </button>
        );
      })}
      {selected.length > 0 ? (
        <button
          type="button"
          onClick={() => onChange([])}
          className="ml-1 text-xs text-fg-dim hover:text-accent"
        >
          Clear
        </button>
      ) : null}
    </fieldset>
  );
}

function GraphSkeleton({ message }: { message: string }) {
  return (
    <div
      aria-busy="true"
      className="flex h-full animate-pulse items-center justify-center bg-card/30 text-sm text-fg-dim"
    >
      {message}
    </div>
  );
}

function GraphCanvas({
  graph,
  matched,
}: {
  graph: VaultGraphType;
  matched: Set<string>;
}) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  // The ref is typed loosely because react-force-graph-2d's exposed methods
  // (zoomToFit) live on the kapsule instance, not in its public TS type when
  // wrapped in React.lazy.
  const graphRef = useRef<{ zoomToFit?: (ms?: number, padding?: number) => void } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({
        w: Math.max(320, Math.floor(rect.width)),
        h: Math.max(320, Math.floor(rect.height)),
      });
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const fitToScreen = () => {
    graphRef.current?.zoomToFit?.(400, 40);
  };

  const graphData = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({ ...n })),
      links: graph.edges.map((e) => ({
        source: e.source,
        target: e.target,
        rel: e.relationship,
      })),
    }),
    [graph],
  );

  const hasFilter = matched.size !== graph.nodes.length;
  const nodeOpacity = (id: string) => (!hasFilter || matched.has(id) ? 1 : 0.15);

  return (
    <div
      ref={containerRef}
      data-testid="vault-graph-canvas"
      // touch-action: none stops the browser from scrolling/zooming the page
      // while the user is panning or pinching the graph itself.
      className="relative h-full w-full touch-none"
    >
      <Suspense fallback={<GraphSkeleton message="Rendering graph…" />}>
        <ForceGraph2D
          ref={graphRef as never}
          graphData={graphData}
          width={size.w}
          height={size.h}
          backgroundColor="rgba(0,0,0,0)"
          nodeLabel={(n) => nodeTooltip(n as unknown as VaultGraphNode)}
          nodeRelSize={5}
          nodeVal={(n) => {
            const node = n as unknown as VaultGraphNode;
            return 2 + Math.min(node.degree, 12);
          }}
          nodeColor={(n) => {
            const node = n as unknown as VaultGraphNode;
            const base = tagColor(node.topTag);
            return hasFilter && !matched.has(node.id) ? fade(base) : base;
          }}
          // Fatter invisible hit area so taps on small nodes are reliable on
          // touch devices. Painted to an offscreen canvas the lib uses for
          // pixel-perfect picking — visible appearance is unchanged.
          nodePointerAreaPaint={(n, color, ctx) => {
            const node = n as unknown as VaultGraphNode & { x?: number; y?: number };
            if (node.x == null || node.y == null) return;
            const val = 2 + Math.min(node.degree, 12);
            const r = Math.max(Math.sqrt(val) * 5, 10);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fill();
          }}
          linkColor={(l) => {
            const link = l as unknown as { source: unknown; target: unknown };
            const srcId = resolveEndpointId(link.source);
            const tgtId = resolveEndpointId(link.target);
            const dim =
              hasFilter && (!matched.has(srcId) || !matched.has(tgtId))
                ? "rgba(160, 160, 160, 0.08)"
                : "rgba(160, 160, 160, 0.35)";
            return dim;
          }}
          linkDirectionalArrowLength={2.5}
          linkDirectionalArrowRelPos={1}
          cooldownTicks={100}
          // Auto-fit once the simulation settles so the user doesn't land on a
          // graph that's panned off-screen.
          onEngineStop={() => fitToScreen()}
          nodeCanvasObjectMode={() => "after"}
          nodeCanvasObject={(n, ctx, globalScale) => {
            const node = n as unknown as VaultGraphNode & { x?: number; y?: number };
            if (node.x == null || node.y == null) return;
            const opacity = nodeOpacity(node.id);
            if (opacity < 0.5) return;
            const fontSize = 10 / globalScale;
            ctx.font = `${fontSize}px sans-serif`;
            ctx.fillStyle = "rgba(220, 220, 220, 0.8)";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(node.title, node.x + 6, node.y);
          }}
          onNodeClick={(n) => {
            const node = n as unknown as VaultGraphNode;
            navigate(`/notes/${encodeURIComponent(node.id)}`);
          }}
        />
      </Suspense>
      <button
        type="button"
        onClick={fitToScreen}
        className="absolute right-3 bottom-3 rounded-md border border-border bg-card/90 px-3 py-1.5 text-xs text-fg-muted shadow-sm backdrop-blur hover:text-accent"
      >
        Fit to screen
      </button>
    </div>
  );
}

function nodeTooltip(n: VaultGraphNode): string {
  const lines = [n.path ?? n.id, `${n.degree} link${n.degree === 1 ? "" : "s"}`];
  if (n.tags.length > 0) lines.push(`tags: ${n.tags.join(", ")}`);
  if (n.summary) lines.push(n.summary);
  return lines.join("\n");
}

function fade(color: string): string {
  if (color.startsWith("hsl(")) return color.replace("hsl(", "hsla(").replace(")", ", 0.2)");
  return color;
}

function resolveEndpointId(endpoint: unknown): string {
  if (typeof endpoint === "string") return endpoint;
  if (endpoint && typeof endpoint === "object" && "id" in endpoint) {
    return String((endpoint as { id: unknown }).id);
  }
  return "";
}

function ErrorBlock({ error }: { error: Error }) {
  const isAuth = error instanceof VaultAuthError;
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="max-w-md rounded-md border border-red-500/30 bg-red-500/5 p-6">
        <p className="mb-2 font-medium text-red-400">
          {isAuth ? "Session expired" : "Could not load vault"}
        </p>
        <p className="mb-4 text-sm text-fg-muted">{error.message}</p>
        {isAuth ? (
          <Link
            to="/add"
            className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Reconnect vault
          </Link>
        ) : null}
      </div>
    </div>
  );
}
