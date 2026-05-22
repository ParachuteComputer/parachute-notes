// RFC 4180 CSV parser — hand-rolled to keep the PWA bundle lean (a CSV-only
// dep like papaparse is ~45 KB minified for features we don't need).
//
// Handles:
//   - quoted cells: `"hello, world",2`
//   - escaped quotes inside quoted cells: `"she said ""hi"""`
//   - newlines inside quoted cells (LF or CRLF)
//   - missing trailing newline
//   - single-column input
//   - empty input
//
// On a fatally malformed row (unterminated quote at EOF) the parser returns
// the rows it managed to extract plus the partial row, with `truncated: true`.
// Callers (CsvRenderer) surface that via an inline warning + plain-text
// fallback.

export interface ParsedCsv {
  rows: string[][];
  truncated: boolean;
}

export function parseCsv(input: string): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let truncated = false;

  const len = input.length;
  let i = 0;
  while (i < len) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote ("") inside a quoted cell stays as a single quote.
        if (i + 1 < len && input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        // Closing quote — exit quoted mode. Anything until the next delimiter
        // is appended verbatim (Excel does this; strict RFC would error, but
        // gentle wins).
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ",") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }

    if (ch === "\n" || ch === "\r") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      // Consume CRLF as a single line terminator.
      if (ch === "\r" && i + 1 < len && input[i + 1] === "\n") {
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    cell += ch;
    i += 1;
  }

  // Flush trailing cell/row. If we end inside an unterminated quote we still
  // surface whatever we collected, but mark it truncated so the caller can
  // warn.
  if (inQuotes) {
    truncated = true;
  }
  // Edge: a single empty input shouldn't synthesize an empty row.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return { rows, truncated };
}
