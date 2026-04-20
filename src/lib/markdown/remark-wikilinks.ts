import type { Root, RootContent, Text } from "mdast";
import type { Plugin } from "unified";

export type WikilinkResolver = (target: string) => { id: string } | null;

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

interface ParentWithChildren {
  children: RootContent[];
}

function splitTextNode(text: string, resolve: WikilinkResolver): RootContent[] {
  const out: RootContent[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(WIKILINK_RE)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      out.push({ type: "text", value: text.slice(lastIndex, matchIndex) });
    }
    const target = match[1]?.trim() ?? "";
    const display = (match[2]?.trim() || target).trim();
    const resolved = resolve(target);
    const href = resolved
      ? `/n/${encodeURIComponent(resolved.id)}`
      : `/n/${encodeURIComponent(target)}`;
    out.push({
      type: "link",
      url: href,
      title: null,
      children: [{ type: "text", value: display }],
      data: {
        hProperties: {
          className: resolved ? "wikilink wikilink-resolved" : "wikilink wikilink-unresolved",
          "data-wikilink-target": target,
          "data-wikilink-resolved": resolved ? "true" : "false",
        },
      },
    });
    lastIndex = matchIndex + match[0].length;
  }
  if (lastIndex === 0) return [{ type: "text", value: text }];
  if (lastIndex < text.length) out.push({ type: "text", value: text.slice(lastIndex) });
  return out;
}

function transformChildren(node: ParentWithChildren, resolve: WikilinkResolver): void {
  const next: RootContent[] = [];
  for (const child of node.children) {
    if (child.type === "text") {
      const pieces = splitTextNode((child as Text).value, resolve);
      next.push(...pieces);
      continue;
    }
    if (child.type === "code" || child.type === "inlineCode") {
      next.push(child);
      continue;
    }
    if ("children" in child && Array.isArray((child as { children?: unknown[] }).children)) {
      transformChildren(child as unknown as ParentWithChildren, resolve);
    }
    next.push(child);
  }
  node.children = next;
}

export const remarkWikilinks: Plugin<[{ resolve: WikilinkResolver }], Root> = ({ resolve }) => {
  return (tree) => {
    transformChildren(tree as unknown as ParentWithChildren, resolve);
  };
};
