import { parseCsv } from "@/lib/render/csv";
import { useMemo } from "react";
import { PlainRenderer } from "./PlainRenderer";

// Render CSV content as an HTML table — first row treated as the header.
// On a fatally malformed CSV (unterminated quote at EOF) we surface what we
// parsed plus an inline warning. If we ended up with no rows at all we fall
// back to the plain-text monospace renderer.

export function CsvRenderer({ content }: { content: string }) {
  const parsed = useMemo(() => parseCsv(content), [content]);

  if (parsed.rows.length === 0) {
    return <PlainRenderer content={content} />;
  }

  const [header, ...body] = parsed.rows;
  // If only one row, render it as the header so users still see the data;
  // otherwise the body would be empty and the table would look wrong.
  const hasBody = body.length > 0;
  const columnCount = Math.max(header?.length ?? 0, ...body.map((r) => r.length));

  return (
    <div className="prose-note">
      {parsed.truncated ? (
        <p className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          This CSV looks malformed (unterminated quoted cell). Showing the rows we could parse.
        </p>
      ) : null}
      {/* Column/row positions are the only stable identity for CSV cells
          (no header column we can rely on for keys), so all three loops below
          use array index as key. */}
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              {Array.from({ length: columnCount }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: positional
                <th key={i} scope="col">
                  {header?.[i] ?? ""}
                </th>
              ))}
            </tr>
          </thead>
          {hasBody ? (
            <tbody>
              {body.map((row, ri) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: positional
                <tr key={ri}>
                  {Array.from({ length: columnCount }).map((_, ci) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: positional
                    <td key={ci}>{row[ci] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          ) : null}
        </table>
      </div>
    </div>
  );
}
