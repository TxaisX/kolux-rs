// EDIT-016: the contents panel of a note. Its entries are the note's headings in order, with
// their plain words (no markdown marks), a level each, and levels that fold. Folded entries are
// remembered per file in this browser profile.
import { marked, type Token, type Tokens } from "marked";

export type Entry = { level: number; text: string };

/** The plain words of inline markdown tokens: emphasis, code and link marks dropped. */
function plain(tokens: Token[] | undefined): string {
  return (tokens ?? [])
    .map((t) => {
      if ("tokens" in t && t.tokens?.length) return plain(t.tokens);
      if (t.type === "html") return "";
      if (t.type === "br") return " ";
      return "text" in t ? String(t.text) : "";
    })
    .join("");
}

/** The headings of a note, in document order (also those inside quotes and list items). */
export function outline(md: string): Entry[] {
  const out: Entry[] = [];
  const walk = (tokens: Token[]) => {
    for (const t of tokens) {
      if (t.type === "heading") out.push({ level: (t as Tokens.Heading).depth, text: plain((t as Tokens.Heading).tokens).replace(/\s+/g, " ").trim() });
      else if (t.type === "blockquote") walk((t as Tokens.Blockquote).tokens);
      else if (t.type === "list") for (const item of (t as Tokens.List).items) walk(item.tokens);
    }
  };
  try {
    walk(marked.lexer(md));
  } catch {
    return [];
  }
  return out;
}

/** The key a folded entry is remembered by: its level and words, so edits elsewhere keep it. */
export const foldKey = (e: Entry) => `${e.level} ${e.text}`;

/** Whether entry `i` has entries under it (the next one is a deeper level). */
export const hasChildren = (list: Entry[], i: number) => i + 1 < list.length && list[i + 1].level > list[i].level;

/** The indices left showing when the entries in `folded` hide everything under them. */
export function visibleEntries(list: Entry[], folded: Set<string>): number[] {
  const shown: number[] = [];
  let hideBelow = Infinity; // entries deeper than this level are under a folded one
  list.forEach((e, i) => {
    if (e.level > hideBelow) return;
    hideBelow = Infinity;
    shown.push(i);
    if (folded.has(foldKey(e)) && hasChildren(list, i)) hideBelow = e.level;
  });
  return shown;
}

const storeKey = (path: string) => `kolux.toc.folded:${path}`;

export function loadFolded(path: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(path)) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveFolded(path: string, folded: Set<string>) {
  try {
    if (folded.size) localStorage.setItem(storeKey(path), JSON.stringify([...folded]));
    else localStorage.removeItem(storeKey(path));
  } catch {
    // A blocked store only means the folds are not remembered.
  }
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** FIX-5 (council P2 P8): which of the headings the page draws (`drawn`, in page order) is entry `i`
 * of `list`: the one with its level and words, counting repeats in order. -1 when the page does not
 * draw it as a heading (the rich view draws a heading inside a quote as plain text); the caller then
 * does not jump, rather than jumping to the heading at the same position in the list. */
export function headingIndex(list: Entry[], i: number, drawn: Entry[]): number {
  const same = (a: Entry, b: Entry) => a.level === b.level && squash(a.text) === squash(b.text);
  let nth = 0;
  for (let k = 0; k < i; k++) if (same(list[k], list[i])) nth++;
  for (let d = 0; d < drawn.length; d++) if (same(drawn[d], list[i]) && nth-- === 0) return d;
  return -1;
}
