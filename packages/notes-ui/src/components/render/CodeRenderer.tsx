import { highlightAs } from "@/lib/render/highlight";
import { useMemo } from "react";

// Render `content` as highlighted code for `language` (a highlight.js
// language ID). Output is wrapped in `<pre><code class="hljs language-X">`
// — same markup the rehype-highlight markdown pipeline produces, so the
// existing github.css theme styles both paths uniformly.

export function CodeRenderer({
  content,
  language,
}: {
  content: string;
  language: string;
}) {
  const html = useMemo(() => highlightAs(content, language), [content, language]);
  return (
    <div className="prose-note">
      <pre>
        {/* highlight.js output is sanitized HTML built from escaped tokens;
            no user-controlled attribute slots flow through. */}
        <code
          // biome-ignore lint/security/noDangerouslySetInnerHtml: see comment above
          dangerouslySetInnerHTML={{ __html: html }}
          className={`hljs language-${language}`}
        />
      </pre>
    </div>
  );
}
