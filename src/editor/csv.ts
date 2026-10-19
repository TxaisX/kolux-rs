// EDIT-023 (T-316): CSV and TSV files read as a table. The separator is worked out from the
// content, a byte-order mark at the start is ignored, and a quoted field that holds separators or
// line breaks stays in one cell ("" inside quotes is a quote).
export const isTable = (path: string) => /\.(csv|tsv)$/i.test(path);

const CANDIDATES = [",", ";", "\t", "|"];
const SAMPLE = 65536;
/** The table view shows this many rows; the rest stay in the source view. */
export const SHOWN_ROWS = 2000;
/** The table view stops scanning after this many characters, and at a cell longer than CELL_CHARS, so an
 * unterminated quote (the rest of the file becomes one cell) cannot read a 30 MB file on the window thread. */
export const SCAN_CHARS = 4_000_000;
export const CELL_CHARS = 1_000_000;

/** Rows of a text. With `limit`, it stops as soon as that many rows are complete, so a huge file costs
 * only as much as the rows asked for. */
export function parseRows(text: string, sep: string, limit = Infinity): string[][] {
  return scanRows(text, sep, limit).rows;
}

/** Like parseRows, with a budget: it also stops after `maxChars` characters scanned, or when one cell grows
 * past `maxCell` (an unterminated quote makes the rest of the file one cell). Then `cut` is true and only
 * the rows that were complete are returned; the half-read row is dropped. */
export function scanRows(text: string, sep: string, limit = Infinity, maxChars = Infinity, maxCell = Infinity): { rows: string[][]; cut: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let started = false; // the current cell has begun (so a quote only opens at its start)
  const endCell = () => {
    row.push(cell);
    cell = "";
    started = false;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };
  if (limit <= 0) return { rows, cut: false };
  for (let i = 0; i < text.length; i++) {
    if (i >= maxChars || cell.length > maxCell) return { rows, cut: true };
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') (cell += '"'), i++;
      else quoted = false;
    } else if (c === '"' && !started) {
      quoted = true;
      started = true;
    } else if (c === sep) endCell();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
      if (rows.length >= limit) return { rows, cut: false };
    } else {
      cell += c;
      started = true;
    }
  }
  // A final line without a line break is a row; a file ending in a line break adds no empty one.
  if (cell !== "" || started || row.length) endRow();
  return { rows, cut: false };
}

/** The separator a text uses: the candidate that splits the first rows into the same number of
 * columns, more than one, on the most rows. A ".tsv" name wins a tie for tab; nothing fits, comma. */
export function detectSeparator(text: string, path = ""): string {
  const sample = text.slice(0, SAMPLE);
  let best = ",";
  let bestScore = 0;
  const order = /\.tsv$/i.test(path) ? ["\t", ...CANDIDATES.filter((c) => c !== "\t")] : CANDIDATES;
  for (const sep of order) {
    const rows = parseRows(sample, sep).slice(0, 20);
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
    const [width, agree] = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [1, 0];
    const score = width > 1 ? agree * 1000 + width : 0;
    if (score > bestScore) [best, bestScore] = [sep, score];
  }
  return best;
}

export type Table = { sep: string; rows: string[][]; /** true when the text has more than was read: more rows than the header, SHOWN_ROWS and one more, or a stop at the character or cell budget */ more?: true };

export function parseTable(text: string, path = ""): Table {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const sep = detectSeparator(body, path);
  // Only the header, the rows shown and one more are read: a 30 MB file never builds its other cells. The
  // character and cell budgets keep an unterminated quote from reading the whole file as one cell.
  const { rows, cut } = scanRows(body, sep, SHOWN_ROWS + 2, SCAN_CHARS, CELL_CHARS);
  return cut || rows.length > SHOWN_ROWS + 1 ? { sep, rows, more: true } : { sep, rows };
}
