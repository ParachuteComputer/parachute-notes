import { useActiveVaultClient } from "@/lib/vault";
import {
  DEFAULT_DEPTH,
  type GraphNode,
  MAX_DEPTH,
  MIN_DEPTH,
  type NeighborhoodGraphData,
  useNeighborhood,
} from "@/lib/vault/neighborhood";
import type { Note } from "@/lib/vault/types";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

const ForceGraph2D = lazy(() => import("react-force-graph-2d"));

interface Props {
  anchor: Note;
}

export function NeighborhoodGraph({ anchor }: Props) {
  const [open, setOpen] = useState(true);
  const [depth, setDepth] = useState(DEFAULT_DEPTH);
  const client = useActiveVaultClient();
  const { data, isLoading } = useNeighborhood(client, open ? anchor : undefined, depth);

  return (
    <section className="mt-10 border-t border-border pt-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="font-serif text-xl text-fg hover:text-accent"
          >
            {open ? "▾" : "▸"} Neighborhood
          </button>
          {open && data ? (
            <span className="text-xs text-fg-dim">
              {data.nodes.length} {data.nodes.length === 1 ? "note" : "notes"}
            </span>
          ) : null}
        </div>
        {open ? <DepthControl depth={depth} onChange={setDepth} /> : null}
      </header>

      {open ? <Body data={data} isLoading={isLoading} /> : null}
    </section>
  );
}

function DepthControl({ depth, onChange }: { depth: number; onChange: (d: number) => void }) {
  const options: number[] = [];
  for (let i = MIN_DEPTH; i <= MAX_DEPTH; i++) options.push(i);
  return (
    <fieldset className="flex items-center gap-1 text-xs text-fg-dim">
      <legend className="mr-1 inline-block">Hops</legend>
      {options.map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={d === depth}
          onClick={() => onChange(d)}
          className={
            d === depth
              ? "rounded border border-accent bg-accent/10 px-2 py-0.5 text-accent"
              : "rounded border border-border bg-card px-2 py-0.5 hover:text-accent"
          }
        >
          {d}
        </button>
      ))}
    </fieldset>
  );
}

function Body({ data, isLoading }: { data: NeighborhoodGraphData | null; isLoading: boolean }) {
  if (!data && isLoading) {
    return <GraphSkeleton />;
  }
  if (!data) return null;
  if (data.nodes.length <= 1) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-center text-sm text-fg-dim">
        This note has no neighbors yet.
      </div>
    );
  }
  return <GraphCanvas data={data} />;
}

function GraphSkeleton() {
  return (
    <div
      aria-busy="true"
      className="h-[24rem] w-full animate-pulse rounded-md border border-border bg-card"
    />
  );
}

function GraphCanvas({ data }: { data: NeighborhoodGraphData }) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 600, h: 384 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: Math.max(320, Math.floor(rect.width)), h: 384 });
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const graphData = useMemo(
    () => ({
      nodes: data.nodes.map((n) => ({ ...n })),
      links: data.edges.map((e) => ({ source: e.source, target: e.target, rel: e.relationship })),
    }),
    [data],
  );

  return (
    <div
      ref={containerRef}
      data-testid="neighborhood-graph-canvas"
      className="overflow-hidden rounded-md border border-border bg-card"
    >
      <Suspense fallback={<GraphSkeleton />}>
        <ForceGraph2D
          graphData={graphData}
          width={size.w}
          height={size.h}
          nodeLabel={(n) => nodeTooltip(n as unknown as GraphNode)}
          nodeVal={(n) => {
            const node = n as unknown as GraphNode;
            return node.isAnchor ? 8 : 3 + Math.min(node.linkCount, 8);
          }}
          nodeColor={(n) => ((n as unknown as GraphNode).isAnchor ? "#c9b170" : "#8a9a7a")}
          linkColor={() => "rgba(160, 160, 160, 0.4)"}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          cooldownTicks={80}
          onNodeClick={(n) => {
            const node = n as unknown as GraphNode;
            navigate(`/n/${encodeURIComponent(node.id)}`);
          }}
        />
      </Suspense>
    </div>
  );
}

function nodeTooltip(n: GraphNode): string {
  const lines = [n.path ?? n.id];
  if (n.tags && n.tags.length > 0) lines.push(`tags: ${n.tags.join(", ")}`);
  if (n.summary) lines.push(n.summary);
  return lines.join("\n");
}
