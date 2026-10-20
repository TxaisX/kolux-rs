// T-238-b (BROW-004): the address bar's drop-down. The back end ranks the visited pages and
// previewed documents (browser_suggest); this is the list's own behaviour: for plain text a
// search entry comes first (for something shaped like an address, a "go to" entry), then the
// hits; Escape, leaving the bar or clicking into the page closes the list and keeps the typed
// text; a closed list stays closed until the text changes; late answers for older text are
// dropped; Up/Down walk the rows and Enter takes the row under the cursor.
import { BLANK, ENGINES, resolveAddress } from "./address";

export type Hit = { kind: "page" | "document"; url: string; title: string; label: string; score?: number };
export type Suggestion = { kind: "search" | "go" | "page" | "document"; url: string; title: string; label: string };

export type Menu = {
  /** The text the rows belong to. */
  text: string;
  items: Suggestion[];
  open: boolean;
  /** The text the list was closed on; it stays closed until the text differs. */
  closedFor: string | null;
  /** The row under the keyboard cursor; -1 is the bar itself. */
  cursor: number;
};

export const fresh = (): Menu => ({ text: "", items: [], open: false, closedFor: null, cursor: -1 });

/** The first row for typed text: a web search for plain words, "go to" for an address. */
export function first(text: string): Suggestion | null {
  const t = text.trim();
  if (!t) return null;
  const r = resolveAddress(t);
  if ("error" in r || r.url === BLANK) return null;
  const search = Object.values(ENGINES).some((prefix) => r.url.startsWith(prefix));
  return search ? { kind: "search", url: r.url, title: `Search for "${t}"`, label: "" } : { kind: "go", url: r.url, title: `Go to ${r.url}`, label: "" };
}

/** The bar's text changed: the list opens again (an identical text leaves a closed list closed). */
export function typed(m: Menu, text: string): Menu {
  const closedFor = m.closedFor !== null && m.closedFor === text ? m.closedFor : null;
  const open = text.trim() !== "" && closedFor === null;
  const items = text === m.text ? m.items : rows(text, []);
  return { text, items, open, closedFor, cursor: -1 };
}

/** The back end's hits for `text` arrived; hits for text the user has moved past are dropped. */
export function arrived(m: Menu, text: string, hits: Hit[]): Menu {
  if (text !== m.text) return m;
  return { ...m, items: rows(text, hits), cursor: Math.min(m.cursor, rows(text, hits).length - 1) };
}

export function rows(text: string, hits: Hit[]): Suggestion[] {
  const head = first(text);
  const rest: Suggestion[] = hits.filter((h) => !head || h.url !== head.url).map((h) => ({ kind: h.kind, url: h.url, title: h.title, label: h.label }));
  return head ? [head, ...rest] : rest;
}

/** Escape, leaving the bar, clicking into the page: closed, the text kept, closed for this text. */
export function closed(m: Menu): Menu {
  return { ...m, open: false, closedFor: m.text, cursor: -1 };
}

export function move(m: Menu, delta: 1 | -1): Menu {
  if (!m.open || m.items.length === 0) return m;
  const n = m.items.length;
  let cursor = m.cursor + delta;
  if (cursor >= n) cursor = -1; // past the last row the cursor is back in the bar
  if (cursor < -1) cursor = n - 1;
  return { ...m, cursor };
}

/** What Enter opens: the row under the cursor, or nothing (the bar's own text is read then). */
export function pick(m: Menu): Suggestion | null {
  return m.open && m.cursor >= 0 ? (m.items[m.cursor] ?? null) : null;
}

/** The text the bar shows while the cursor walks the rows: the row's address, or the typed text. */
export function shown(m: Menu, typedText: string): string {
  const p = pick(m);
  if (!p || p.kind === "search") return typedText;
  return p.kind === "document" ? p.label || p.url : p.url;
}

/** A row's two lines: a page by its title over its address, a document by its file over its path. */
export function lines(s: Suggestion): [string, string] {
  if (s.kind === "search" || s.kind === "go") return [s.title, ""];
  if (s.kind === "document") return [s.title || s.label, s.label];
  return [s.title || s.url, s.title ? s.url : ""];
}
