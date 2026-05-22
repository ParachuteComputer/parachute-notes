import { CodeRenderer } from "@/components/render/CodeRenderer";
import { CsvRenderer } from "@/components/render/CsvRenderer";
import { JsonRenderer } from "@/components/render/JsonRenderer";
import { PlainRenderer } from "@/components/render/PlainRenderer";
import { YamlRenderer } from "@/components/render/YamlRenderer";
import type { WikilinkResolver } from "@/lib/markdown/remark-wikilinks";
import { CODE_EXTENSIONS, extensionOf, formatForPath } from "@/lib/render/format";
import { MarkdownView } from "./MarkdownView";

// Phase 2 dispatcher: pick the right format-specific renderer based on the
// note's path extension. Markdown stays the default (no extension or
// .md/.mdx/.markdown). Everything else is read-only — the editor still uses
// CodeMirror with markdown grammar, that's a separate Phase 3 concern.

export interface NoteLike {
  path?: string;
  content?: string;
}

export function NoteRenderer({
  note,
  resolve,
  className,
}: {
  note: NoteLike;
  // Required only for the markdown branch; the other renderers don't carry
  // wikilinks. Kept required at the type level so existing call sites
  // (NoteView, NoteEditor preview, NoteNew preview) which already build a
  // resolver pass it without thinking — and so future markdown notes don't
  // silently lose wikilink resolution.
  resolve: WikilinkResolver;
  className?: string;
}) {
  const content = note.content ?? "";
  const format = formatForPath(note.path);

  switch (format) {
    case "markdown":
      return <MarkdownView content={content} resolve={resolve} className={className} />;
    case "csv":
      return <CsvRenderer content={content} />;
    case "json":
      return <JsonRenderer content={content} />;
    case "yaml":
      return <YamlRenderer content={content} />;
    case "code": {
      const ext = extensionOf(note.path);
      const language = CODE_EXTENSIONS[ext] ?? "plaintext";
      return <CodeRenderer content={content} language={language} />;
    }
    default:
      return <PlainRenderer content={content} />;
  }
}
