import { type WikilinkResolver, remarkWikilinks } from "@/lib/markdown/remark-wikilinks";
import type { Note } from "@/lib/vault/types";
import ReactMarkdown, { type Components } from "react-markdown";
import { Link } from "react-router";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { VaultImage } from "./VaultImage";

export function buildWikilinkResolver(note: Note): WikilinkResolver {
  const map = new Map<string, string>();
  for (const l of note.links ?? []) {
    if (l.sourceId !== note.id || !l.targetNote) continue;
    if (l.targetNote.path) map.set(l.targetNote.path, l.targetNote.id);
    map.set(l.targetNote.id, l.targetNote.id);
  }
  return (target) => {
    const id = map.get(target);
    return id ? { id } : null;
  };
}

const MARKDOWN_COMPONENTS: Components = {
  img({ node: _node, src, alt, className }) {
    if (!src) return null;
    return <VaultImage src={src} alt={alt ?? ""} className={className} />;
  },
  a({ node: _node, href, className, children, ...rest }) {
    const classes = className ?? "";
    if (classes.includes("wikilink")) {
      const styleCls = classes.includes("wikilink-resolved")
        ? "text-accent hover:underline"
        : "text-fg-dim underline decoration-dashed underline-offset-4 hover:text-fg";
      return (
        <Link
          to={href ?? "#"}
          className={`${classes} ${styleCls}`}
          {...(rest as Record<string, unknown>)}
        >
          {children}
        </Link>
      );
    }
    if (href && (href.startsWith("/") || href.startsWith("#"))) {
      return (
        <Link to={href} className="text-accent hover:underline">
          {children}
        </Link>
      );
    }
    return (
      <a
        href={href}
        className="text-accent hover:underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  },
};

export function MarkdownView({
  content,
  resolve,
  className,
}: {
  content: string;
  resolve: WikilinkResolver;
  className?: string;
}) {
  return (
    <div className={`prose-note ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkWikilinks, { resolve }]]}
        rehypePlugins={[rehypeHighlight]}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
