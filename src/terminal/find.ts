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

// The bar's matches are found in each logical line's text (rows a long line wrapped onto joined back
// together), then placed on cells: a wide character takes two cells but one index, so a string index is
// not a column. `at[i]` is the cell index i starts in and `to[i]` the cell after it, both counted as
// row * cols + x over the whole buffer.
export type Line = { text: string; at: number[]; to: number[] };
export type Cell = { chars: string; width: number };
/** One buffer row: its cells (a plain string is one cell per character), and whether it continues the row above. */
export type BufRow = { wrapped: boolean; cells: string | readonly Cell[] };

/** The logical lines of a buffer, top first; each loses its trailing blanks. */
export function linesOf(rows: readonly BufRow[], cols: number): Line[] {
  const out: Line[] = [];
  let cur: Line | null = null;
  const end = (l: Line) => {
    const n = l.text.replace(/\s+$/, "").length;
    out.push({ text: l.text.slice(0, n), at: l.at.slice(0, n), to: l.to.slice(0, n) });
  };
  rows.forEach((r, y) => {
    if (!cur || !r.wrapped) {
      if (cur) end(cur);
      cur = { text: "", at: [], to: [] };
    }
    const line: Line = cur;
    const put = (s: string, x: number, w: number) => {
      for (let i = 0; i < s.length; i++) {
        line.at.push(y * cols + x);
        line.to.push(y * cols + x + w);
      }
      line.text += s;
    };
    if (typeof r.cells === "string") for (let x = 0; x < r.cells.length; x++) put(r.cells[x], x, 1);
    else r.cells.forEach((c, x) => c.width > 0 && put(c.chars || " ", x, c.width)); // width 0: a wide character's right half
  });
  if (cur) end(cur);
  return out;
}

/** Text-space matches (row = line, col = index) placed on cells: row and col of the first cell, len cells to the end. */
export function placeMatches(lines: readonly Line[], hits: readonly Match[], cols: number): Match[] {
  return hits.map((h) => {
    const l = lines[h.row];
    const start = l.at[h.col];
    return { row: Math.floor(start / cols), col: start % cols, len: l.to[h.col + h.len - 1] - start };
  });
}

/** A placed match cut into one piece per row, for the marks drawn under it. */
export function segments(m: Match, cols: number): Match[] {
  const out: Match[] = [];
  for (let pos = m.row * cols + m.col, left = m.len; left > 0; ) {
    const col = pos % cols;
    const len = Math.min(left, cols - col);
    out.push({ row: Math.floor(pos / cols), col, len });
    pos += len;
    left -= len;
  }
  return out;
}

// A regular expression is the user's own and can backtrack for minutes on one line, and a single exec
// cannot be interrupted, so the pane runs it off the main thread: it waits REGEX_DELAY after the last
// keystroke, then gives the run REGEX_BUDGET before stopping it and saying the pattern took too long.
// A plain search is linear and runs at once.
export const REGEX_DELAY = 200;
export const REGEX_BUDGET = 500;
export type Runner = { run: (texts: readonly string[], query: string, opts: FindOptions, done: (hits: Match[]) => void) => void; stop: () => void };

/** Schedules one regex search; the returned function cancels it (and stops a run under way). */
export function searchLater(texts: () => readonly string[], query: string, opts: FindOptions, done: (hits: Match[]) => void, slow: () => void, spawn: () => Runner): () => void {
  let live = true;
  let runner: Runner | undefined;
  let budget: ReturnType<typeof setTimeout> | undefined;
  const wait = setTimeout(() => {
    const r = (runner = spawn());
    budget = setTimeout(() => {
      live = false;
      r.stop();
      slow();
    }, REGEX_BUDGET);
    r.run(texts(), query, opts, (hits) => {
      if (!live) return;
      live = false;
      clearTimeout(budget);
      r.stop();
      done(hits);
    });
  }, REGEX_DELAY);
  return () => {
    live = false;
    clearTimeout(wait);
    clearTimeout(budget);
    runner?.stop();
  };
}
