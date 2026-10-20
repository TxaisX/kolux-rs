// EDIT-019 (T-177): a note's front matter (YAML between --- lines, TOML between +++ lines) is kept
// out of the text the rich view edits, and a rich edit changes only the span of the body that
// differs, so everything else in the file (the front matter, line ends, raw HTML) stays byte for
// byte as it was. The text here is the buffer's (CodeMirror joins lines with \n; the file's own
// line ends are put back when it is written).
import { changeBetween } from "./markdown";

/** The front matter block including its closing line and that line's end ("" when there is none),
 *  and the rest of the note. `front + body` is always the whole text. */
export function splitFront(text: string): { front: string; body: string; kind: "yaml" | "toml" | null } {
  const m = /^(---|\+\+\+)[ \t]*\r?\n/.exec(text);
  if (!m) return { front: "", body: text, kind: null };
  const fence = m[1];
  const closer = fence === "---" ? /^(---|\.\.\.)[ \t]*(\r?\n|$)/gm : /^\+\+\+[ \t]*(\r?\n|$)/gm;
  closer.lastIndex = m[0].length;
  const c = closer.exec(text);
  if (!c) return { front: "", body: text, kind: null }; // never closed: it is note text, not front matter
  const end = c.index + c[0].length;
  return { front: text.slice(0, end), body: text.slice(end), kind: fence === "---" ? "yaml" : "toml" };
}

/** The change to the buffer for one rich edit: `now` is the buffer's text, `out` the markdown the
 *  rich view gives back for the body. Null when the body is unchanged. */
export function richChange(now: string, out: string): { from: number; to: number; insert: string } | null {
  const { front, body } = splitFront(now);
  // The rich view drops the body's last line end; keep it.
  const next = body.endsWith("\n") && !out.endsWith("\n") ? out + "\n" : out;
  const c = changeBetween(body, next);
  return c && { from: c.from + front.length, to: c.to + front.length, insert: c.insert };
}
