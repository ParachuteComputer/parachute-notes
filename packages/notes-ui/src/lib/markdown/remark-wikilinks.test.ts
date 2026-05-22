import type { Root } from "mdast";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { type WikilinkResolver, remarkWikilinks } from "./remark-wikilinks";

function makeResolver(map: Record<string, string>): WikilinkResolver {
  return (target) => (map[target] ? { id: map[target] } : null);
}

function processToTree(md: string, resolve: WikilinkResolver): Root {
  const tree = unified().use(remarkParse).use(remarkWikilinks, { resolve }).parse(md);
  return unified().use(remarkWikilinks, { resolve }).runSync(tree) as Root;
}

interface LinkLike {
  type: string;
  url?: string;
  data?: { hProperties?: Record<string, unknown> };
  children?: LinkLike[];
  value?: string;
}

function flattenLinks(node: LinkLike, acc: LinkLike[] = []): LinkLike[] {
  if (node.type === "link") acc.push(node);
  for (const child of node.children ?? []) flattenLinks(child, acc);
  return acc;
}

describe("remarkWikilinks", () => {
  it("replaces [[target]] with a resolved link node when target is in the map", () => {
    const tree = processToTree(
      "See [[Canon/Uni]] for more.",
      makeResolver({ "Canon/Uni": "abc-123" }),
    );
    const links = flattenLinks(tree as unknown as LinkLike);
    expect(links).toHaveLength(1);
    expect(links[0]?.url).toBe("/n/abc-123");
    const cls = links[0]?.data?.hProperties?.className as string;
    expect(cls).toContain("wikilink-resolved");
    expect(links[0]?.children?.[0]?.value).toBe("Canon/Uni");
  });

  it("marks unresolved wikilinks with a distinct class", () => {
    const tree = processToTree("Orphan [[Missing/Note]].", makeResolver({}));
    const links = flattenLinks(tree as unknown as LinkLike);
    expect(links).toHaveLength(1);
    const cls = links[0]?.data?.hProperties?.className as string;
    expect(cls).toContain("wikilink-unresolved");
    expect(links[0]?.url).toBe("/n/Missing%2FNote");
  });

  it("honors the display text form [[target|Display]]", () => {
    const tree = processToTree(
      "Read [[Canon/Uni|the Uni canon]].",
      makeResolver({ "Canon/Uni": "uni-id" }),
    );
    const links = flattenLinks(tree as unknown as LinkLike);
    expect(links[0]?.children?.[0]?.value).toBe("the Uni canon");
  });

  it("does not touch [[target]] inside fenced code blocks", async () => {
    const md = "```\n[[Canon/Uni]]\n```\n";
    const out = await unified()
      .use(remarkParse)
      .use(remarkWikilinks, { resolve: makeResolver({ "Canon/Uni": "x" }) })
      .use(remarkStringify)
      .process(md);
    expect(String(out)).toContain("[[Canon/Uni]]");
  });

  it("does not touch [[target]] inside inline code", async () => {
    const md = "This is literal: `[[Canon/Uni]]`.";
    const out = await unified()
      .use(remarkParse)
      .use(remarkWikilinks, { resolve: makeResolver({ "Canon/Uni": "x" }) })
      .use(remarkStringify)
      .process(md);
    expect(String(out)).toContain("`[[Canon/Uni]]`");
  });

  it("handles multiple wikilinks in a single paragraph", () => {
    const tree = processToTree(
      "Links: [[A]], [[B]], and [[C]].",
      makeResolver({ A: "a-id", C: "c-id" }),
    );
    const links = flattenLinks(tree as unknown as LinkLike);
    expect(links).toHaveLength(3);
    expect(links[0]?.url).toBe("/n/a-id");
    expect(links[1]?.url).toBe("/n/B");
    expect(links[2]?.url).toBe("/n/c-id");
  });
});
