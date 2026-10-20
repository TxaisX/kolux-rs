// TERM-092 / TERM-093: web links and file paths printed in a terminal are clickable (Ctrl+click, Cmd+click on
// macOS; a plain click still selects). Pure text work lives here so it can be tested without xterm: what a row
// holds, where each link starts and ends, what a path resolves to against the pane's folder, and how a link
// that wraps over several rows is read as one. Nothing here touches the disk: a path is a link because it
// looks like one, never because it was probed (a network share is never stat-ed).
// ponytail: one regex pass per row; a provider cache keyed on row text if a 10k-column buffer ever shows lag.

export type Found = { start: number; end: number; kind: "url" | "file"; target: string; line?: number; column?: number };

/** Punctuation that ends a sentence, not a link: "see https://x.y/z." or "(C:\a\b.txt)" keeps the link clean. */
const TRAIL = /[.,;:!?'"`]+$/;
const SUFFIX = "(?::(\\d+)(?::(\\d+))?|\\((\\d+)(?:,(\\d+))?\\))?";
/** Each alternative is one shape: web link, file link, Windows drive or UNC path, a path with a separator
 *  (absolute POSIX, ./relative, ~/home or plain src/a/b.ts), or a bare name.ext:line (compiler output).
 *  TERM-095: the path and name shapes start only where their character run starts (the lookbehinds): a greedy
 *  run that is then backtracked for a separator costs one pass per run, not one per character, so a long
 *  separator-free span (base64, a wall of dots or hyphens) scans in linear time; measured 16 KiB of "x" at
 *  194 ms without them and under 2 ms with. What matches is unchanged: a start inside a run never matched
 *  anything its run's start did not. */
const RE = new RegExp(
  [
    "\\bhttps?://[^\\s<>\"'`]+",
    "\\bfile://[^\\s<>\"'`]+",
    "(?:[A-Za-z]:[\\\\/]|\\\\\\\\[^\\s\\\\/]+\\\\)[^\\s:*?\"<>|()]*" + SUFFIX,
    "(?<![\\w.@~-])(?:\\.{1,2}[\\\\/]|~/|/)?[\\w.@~-]+(?:[\\\\/][\\w.@~-]+)+(?<![\\\\/.])" + SUFFIX,
    // the name shape may start after leading hyphens ("-foo.ts:3" finds foo.ts:3, as \b alone did)
    "\\b(?<=(?:^|[^\\w-])-*)[\\w-]+\\.[A-Za-z]{1,6}" + SUFFIX,
  ].join("|"),
  "g",
);
const DRIVE_OR_ROOT = /^(?:[A-Za-z]:[\\/]|\\\\|\/|\.{1,2}[\\/]|~\/)/;

/** Every link in one row (or one joined span of wrapped rows), left to right, with trailing punctuation left out. */
export function findLinks(text: string): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(RE)) {
    let raw = m[0];
    const isUrl = /^(https?|file):\/\//i.test(raw);
    // the bare name.ext shape is a link only with a :line after it (otherwise "node.js" would be one)
    if (!isUrl && !/[\\/]/.test(raw) && !/[:(]\d/.test(raw)) continue;
    // a plain relative shape needs a letter somewhere: "16/10" and "3/4" are numbers, not files
    if (!isUrl && !DRIVE_OR_ROOT.test(raw) && !/[A-Za-z]/.test(raw)) continue;
    // an unmatched ")" at the end belongs to the sentence, a matched one to the link (Wikipedia-style)
    raw = raw.replace(TRAIL, "");
    while (raw.endsWith(")") && (raw.match(/\(/g)?.length ?? 0) < (raw.match(/\)/g)?.length ?? 0)) raw = raw.slice(0, -1).replace(TRAIL, "");
    if (raw.length === 0) continue;
    const start = m.index!;
    const end = start + raw.length;
    if (isUrl && !/^file:/i.test(raw)) {
      out.push({ start, end, kind: "url", target: raw });
      continue;
    }
    const at = raw.match(/(?::(\d+)(?::(\d+))?|\((\d+)(?:,(\d+))?\))$/);
    const target = at ? raw.slice(0, raw.length - at[0].length) : raw;
    const line = at ? Number(at[1] ?? at[3]) : undefined;
    const column = at && (at[2] ?? at[4]) ? Number(at[2] ?? at[4]) : undefined;
    // A decoded name with a control character is no link: Windows stops reading at a NUL, so
    // "run.bat%00.txt" would look like a text file here and run as run.bat when opened.
    const file = fromFileUrl(target);
    if (file === null || CONTROL.test(file)) continue;
    out.push({ start, end, kind: "file", target: file, ...(line !== undefined ? { line } : {}), ...(column !== undefined ? { column } : {}) });
  }
  return out;
}

const CONTROL = /[\x00-\x1f\x7f]/;

/** file:///C:/a/b.txt → C:/a/b.txt; file:///home/x → /home/x; file://server/share/x → \\server\share\x.
 *  Null for a malformed % escape. */
export function fromFileUrl(s: string): string | null {
  const m = s.match(/^file:\/\/([^/]*)(\/.*)?$/i);
  if (!m) return s;
  const host = m[1];
  let path: string;
  try {
    path = decodeURIComponent(m[2] ?? "/");
  } catch {
    return null;
  }
  if (host && host !== "localhost") return `\\\\${host}${path.replace(/\//g, "\\")}`;
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  return path;
}

const isAbsolute = (p: string) => /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(p);

/** A relative path resolved against the pane's folder; "." and ".." segments folded; an absolute path kept. */
export function resolvePath(target: string, cwd: string | null): string | null {
  let p = target.replace(/^~\//, "");
  if (!isAbsolute(p)) {
    if (!cwd) return null;
    const sep = /\\/.test(cwd) || /^[A-Za-z]:/.test(cwd) ? "\\" : "/";
    const parts = cwd.replace(/[\\/]+$/, "").split(/[\\/]/);
    for (const seg of p.split(/[\\/]/)) {
      if (seg === "." || seg === "") continue;
      if (seg === "..") {
        if (parts.length > 1) parts.pop();
      } else parts.push(seg);
    }
    p = parts.join(sep);
  }
  return p;
}

export type Row = { text: string; isWrapped: boolean };

/** TERM-095: the longest logical line (in cells) that is scanned for links; longer ones get none. */
export const LINK_SCAN_CAP = 16 * 1024;

/** The rows that make up the logical line holding row `y`: back to the first unwrapped row, forward while the next
 *  row says it is wrapped. Returns the first row's index and the joined text, every row but the last padded to `cols`
 *  so an index in the text maps back to a cell. */
export function spanOf(row: (y: number) => Row | undefined, y: number, cols: number, cap = LINK_SCAN_CAP): { first: number; text: string } {
  // TERM-095: a logical line past the cap gets no link scan; the walk stops at the cap too, so a hover over a 1 MB line
  // costs a few hundred row lookups, never a join of the whole line and a regex pass over it.
  const maxRows = Math.max(1, Math.floor(cap / Math.max(1, cols)));
  let first = y;
  while (first > 0 && row(first)?.isWrapped) {
    if (y - first >= maxRows) return { first: y, text: "" };
    first--;
  }
  let last = y;
  while (row(last + 1)?.isWrapped) {
    if (last - first + 1 >= maxRows) return { first, text: "" };
    last++;
  }
  const parts: string[] = [];
  for (let i = first; i <= last; i++) {
    const t = row(i)?.text ?? "";
    parts.push(i < last ? t.padEnd(cols) : t.replace(/\s+$/, ""));
  }
  return { first, text: parts.join("") };
}

/** xterm's 1-based inclusive cell range for a [start, end) index span of a joined line. */
export function rangeOf(start: number, end: number, first: number, cols: number) {
  const cell = (i: number) => ({ x: (i % cols) + 1, y: first + Math.floor(i / cols) + 1 });
  return { start: cell(start), end: cell(end - 1) };
}

/** Where a plain modifier-click goes, said in the hover hint. */
export type Where = "browser" | "kolux" | "editor" | "app";
const WHERE: Record<Where, string> = { browser: "in your browser", kolux: "in Kolux", editor: "in the editor", app: "with its app" };

/** The hover hint under the pointer: the modifier, the target, the line, and where it will open. */
export const hintFor = (f: Found, mac: boolean, where: Where) => `${mac ? "Cmd" : "Ctrl"}+click to open ${f.target}${f.line !== undefined ? ` at line ${f.line}` : ""} ${WHERE[where]}`;

/** Which door a click goes through: the system browser (always with Shift, or when Open-in-Kolux is off), Kolux's own
 *  viewer, or the file opener. Alt with the link modifier inverts the web destination (Kolux when the setting says the
 *  browser, the browser when it says Kolux); Shift beats Alt. `kolux` is whether a Kolux viewer is wired at all; without
 *  one every web link goes to the system browser. Returns null for a click without the modifier (a plain click selects). */
export function clickTarget(f: Found, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey?: boolean }, mac: boolean, openInKolux: boolean, kolux = openInKolux): "system" | "kolux" | "file" | null {
  if (!(mac ? e.metaKey : e.ctrlKey)) return null;
  if (f.kind === "file") return "file";
  if (e.shiftKey || !kolux) return "system";
  return openInKolux !== !!e.altKey ? "kolux" : "system";
}

/** An OSC 8 link's own target as a Found, or null when it is not a web or file link (other schemes stay text). */
export const linkFor = (uri: string): Found | null => findLinks(uri).find((f) => f.start === 0) ?? null;

/** ACCT-061: the last check before a link is opened. A web link opens only as http, https or file (the Rust side
 *  refuses anything else too); a file target must be a plain path with no control character. Everything else is
 *  ignored: nothing opens, nothing is said. */
export function allowed(f: Found): boolean {
  if (f.target.length === 0 || /[\u0000-\u001f\u007f]/.test(f.target)) return false;
  if (f.kind === "url") return /^(https?|file):\/\//i.test(f.target);
  return true;
}

/** ACCT-061: a link scan that trips over unusual output (a regex that blows the stack, a buffer row that is gone)
 *  is contained: that row has no links and the pane keeps working. `note` hears the error once, for the log. */
export function safeLinks<T>(scan: () => T[], note?: (e: unknown) => void): T[] {
  try {
    return scan();
  } catch (e) {
    note?.(e);
    return [];
  }
}
