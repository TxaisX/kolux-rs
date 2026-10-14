// TERM-077: the find bar's logic over the buffer's rows (each row's text, scrollback included). A plain
// search by default; Match case and Regex toggles. A bad regular expression is no match at all and never
// an exception; the query is capped so a pasted novel does not stall the bar; matches are capped too.
// The pane owns the drawing (decorations and the selection on the current match).

export const QUERY_CAP = 256;
export const MATCH_CAP = 1000;

export type FindOptions = { caseSensitive: boolean; regex: boolean };
export type Match = { row: number; col: number; len: number };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The matcher for a query, or null when there is nothing to search for or the pattern is invalid. */
export function compile(query: string, opts: FindOptions): RegExp | null {
  const q = query.slice(0, QUERY_CAP);
  if (q === "") return null;
  try {
    return new RegExp(opts.regex ? q : escapeRe(q), opts.caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

/** Every match, top row first, left to right; zero-length matches are skipped; capped at MATCH_CAP. */
export function findIn(lines: readonly string[], query: string, opts: FindOptions): Match[] {
  const re = compile(query, opts);
  if (!re) return [];
  const out: Match[] = [];
  for (let row = 0; row < lines.length && out.length < MATCH_CAP; row++) {
    re.lastIndex = 0;
    const line = lines[row];
    for (let m = re.exec(line); m !== null && out.length < MATCH_CAP; m = re.exec(line)) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      out.push({ row, col: m.index, len: m[0].length });
    }
  }
  return out;
}

/** The next (1) or previous (-1) match index, wrapping; -1 when there are none. */
export function stepIndex(count: number, current: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return dir === 1 ? 0 : count - 1;
  return (current + dir + count) % count;
}

/** Where to start after the query changes: the first match at or below the top of the view, else the first. */
export function nearestFrom(matches: readonly Match[], viewTop: number): number {
  if (matches.length === 0) return -1;
  const i = matches.findIndex((m) => m.row >= viewTop);
  return i < 0 ? 0 : i;
}

/** The count shown beside the box. */
export function countLabel(count: number, current: number, query: string): string {
  if (query === "") return "";
  if (count === 0) return "No matches";
  return `${current + 1} of ${count >= MATCH_CAP ? `${MATCH_CAP}+` : count}`;
}
