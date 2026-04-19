import { useExpandedPaths } from "@/lib/path-tree/expanded";
import type { PathTreeNode } from "@/lib/path-tree/tree";
import { buildPathTree } from "@/lib/path-tree/tree";
import { useMemo } from "react";

// Collapsible folder nav for the /notes sidebar. Derived from a flat list of
// note paths; click a folder to drive the `path_prefix` filter. Read-only —
// folders aren't a write surface here. The selected prefix is highlighted and
// the ancestors along its chain are force-expanded so the user can always
// see where they are.
interface Props {
  paths: Iterable<string | undefined>;
  vaultId: string;
  currentPrefix: string;
  onSelect(prefix: string): void;
}

export function PathTree({ paths, vaultId, currentPrefix, onSelect }: Props) {
  const tree = useMemo(() => buildPathTree(paths), [paths]);
  const { expanded, toggle } = useExpandedPaths(vaultId);

  const forcedOpen = useMemo(() => ancestorsOf(currentPrefix), [currentPrefix]);

  if (tree.length === 0) {
    return (
      <aside aria-label="Path tree">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-fg-dim">Folders</h2>
        <p className="text-xs text-fg-dim">No folders yet.</p>
      </aside>
    );
  }

  return (
    <aside aria-label="Path tree" className="md:sticky md:top-6 md:self-start">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs uppercase tracking-wider text-fg-dim">Folders</h2>
        {currentPrefix ? (
          <button
            type="button"
            onClick={() => onSelect("")}
            className="text-xs text-fg-dim hover:text-accent"
          >
            Clear
          </button>
        ) : null}
      </div>
      <ul className="space-y-0.5">
        {tree.map((node) => (
          <TreeNode
            key={node.fullPath}
            node={node}
            depth={0}
            expanded={expanded}
            forcedOpen={forcedOpen}
            currentPrefix={currentPrefix}
            onToggle={toggle}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </aside>
  );
}

function TreeNode({
  node,
  depth,
  expanded,
  forcedOpen,
  currentPrefix,
  onToggle,
  onSelect,
}: {
  node: PathTreeNode;
  depth: number;
  expanded: Set<string>;
  forcedOpen: Set<string>;
  currentPrefix: string;
  onToggle(path: string): void;
  onSelect(prefix: string): void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.fullPath) || forcedOpen.has(node.fullPath);
  const isSelected = currentPrefix === node.fullPath;

  return (
    <li>
      <div
        className={`flex items-center gap-1 rounded-md px-1 py-0.5 text-sm ${
          isSelected ? "bg-accent/10 text-accent" : "text-fg-muted hover:text-accent"
        }`}
        style={{ paddingLeft: `${depth * 0.75 + 0.25}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.fullPath)}
            aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.fullPath}`}
            aria-expanded={isOpen}
            className="flex h-4 w-4 items-center justify-center text-fg-dim hover:text-accent"
          >
            <span aria-hidden="true" className="font-mono text-xs">
              {isOpen ? "▾" : "▸"}
            </span>
          </button>
        ) : (
          <span aria-hidden="true" className="inline-block h-4 w-4" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.fullPath)}
          aria-current={isSelected ? "true" : undefined}
          className="flex flex-1 items-baseline gap-1.5 truncate text-left"
        >
          <span className="truncate">{node.name}</span>
          <span className="text-xs text-fg-dim">{node.count}</span>
        </button>
      </div>
      {hasChildren && isOpen ? (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <TreeNode
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              forcedOpen={forcedOpen}
              currentPrefix={currentPrefix}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// Given `Canon/Aaron/Log`, return `{Canon, Canon/Aaron, Canon/Aaron/Log}` so
// the tree stays open along the selected path even when the user hasn't
// manually expanded each ancestor.
function ancestorsOf(prefix: string): Set<string> {
  const out = new Set<string>();
  if (!prefix) return out;
  const parts = prefix.split("/").filter((p) => p.length > 0);
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    out.add(acc);
  }
  return out;
}
