// EDIT-023 (T-316): CSV and TSV files read as a table. The separator is worked out from the
// content, a byte-order mark at the start is ignored, and a quoted field that holds separators or
// line breaks stays in one cell ("" inside quotes is a quote).
export const isTable = (path: string) => /\.(csv|tsv)$/i.test(path);

const CANDIDATES = [",", ";", "\t", "|"];
const SAMPLE = 65536;
/** The table view shows this many rows; the rest stay in the source view. */
export const SHOWN_ROWS = 2000;

export function parseRows(text: string, sep: string): string[][] {
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
  for (let i = 0; i < text.length; i++) {
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
    } else {
      cell += c;
      started = true;
    }
  }
  // A final line without a line break is a row; a file ending in a line break adds no empty one.
  if (cell !== "" || started || row.length) endRow();
  return rows;
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

export type Table = { sep: string; rows: string[][] };

export function parseTable(text: string, path = ""): Table {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const sep = detectSeparator(body, path);
  return { sep, rows: parseRows(body, sep) };
}
