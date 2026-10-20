// BROW-037: notes on a page's elements. The user picks elements in the page (browser_annotate runs
// the picker there), writes a note on each, and sends the lot to an agent in the worktree as one
// message. This file is the pure part: the tray's rules and the message's text.
import { cleanUrl, maskSecrets, scrubPick } from "./scrub";

/** The most notes one tray holds; picking stops when it is full. */
export const MAX_NOTES = 20;
/** The most characters one note keeps. */
export const NOTE_MAX = 2000;
/** The most characters of an element's own text that go in the message. */
export const TEXT_MAX = 200;

/** What the picker in the page says about a clicked element. */
export type Pick = {
  selector: string;
  path?: string;
  tag?: string;
  text?: string;
  component?: string;
  source?: string;
  hints?: Record<string, string>;
  styles?: Record<string, string>;
  box?: { x: number; y: number; width: number; height: number };
  url?: string;
};

export type Note = { pick: Pick; text: string };

/** Whitespace trimmed, runs of blank lines folded to one blank line, cut to `NOTE_MAX`. */
export function trim(text: string): string {
  return cut(text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim(), NOTE_MAX);
}

/** The first `n` characters (code points, so an emoji is never halved) with an ellipsis when cut. */
export function cut(s: string, n: number): string {
  const chars = Array.from(s);
  return chars.length <= n ? s : chars.slice(0, Math.max(0, n - 1)).join("") + "…";
}

/** The element's text on one line. */
export function fold(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Adds a note to the tray; `null` when the tray is full. An empty note is not kept. */
export function addNote(notes: Note[], pick: Pick, text: string): Note[] | null {
  if (notes.length >= MAX_NOTES) return null;
  const t = trim(text);
  if (!t) return notes;
  return [...notes, { pick, text: t }];
}

/** Notes belong to one page: a new address (the hash aside) empties the tray. */
export function sameAddress(a: string, b: string): boolean {
  const bare = (u: string) => u.replace(/#.*$/, "");
  return bare(a) === bare(b);
}

/** A backtick fence longer than any run of backticks in the text (at least three). */
export function fence(text: string): string {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
  return "`".repeat(longest + 1);
}

/** One note's lines in the message. */
function noteLines(n: Note, i: number): string[] {
  const p = n.pick;
  const head = [p.component && `component ${p.component}`, p.source && `at ${p.source}`].filter(Boolean).join(", ");
  const out = [`${i + 1}. \`${p.selector}\`${head ? ` (${head})` : ""}`];
  if (p.path) out.push(`   path: ${p.path}`);
  if (p.text) out.push(`   text: "${cut(fold(p.text), TEXT_MAX)}"`);
  const hints = Object.entries(p.hints ?? {}).filter(([k]) => k !== "class");
  if (hints.length) out.push(`   attributes: ${hints.map(([k, v]) => `${k}="${v}"`).join(" ")}`);
  if (p.hints?.class) out.push(`   class: ${p.hints.class}`);
  const styles = Object.entries(p.styles ?? {});
  if (styles.length) out.push(`   styles: ${styles.map(([k, v]) => `${k}: ${v}`).join("; ")}`);
  if (p.box) out.push(`   box: ${p.box.width}×${p.box.height} at ${p.box.x},${p.box.y}`);
  if (n.text.includes("\n") || n.text.includes("`")) {
    const f = fence(n.text);
    out.push("   note:", f, n.text, f);
  } else out.push(`   note: ${n.text}`);
  return out;
}

/** The message sent to the agent; `null` with nothing to send. */
export function notesMarkdown(notes: Note[], title: string, url: string): string | null {
  if (notes.length === 0) return null;
  const bare = cleanUrl(url) ?? ""; // T-158 (BROW-036)
  const lines = [`Page notes on ${maskSecrets(title) || bare} (${bare}), ${notes.length} element${notes.length === 1 ? "" : "s"}:`, ""];
  notes.forEach((n, i) => lines.push(...noteLines(n, i), ""));
  return lines.join("\n").trimEnd() + "\n";
}

/** What the picker queued since the last poll: new picks and whether Escape was pressed in the page. */
export function readPicks(answer: unknown): { active: boolean; picks: Pick[]; escape: boolean } {
  const a = (answer ?? {}) as { active?: boolean; picks?: unknown[] };
  const picks: Pick[] = [];
  let escape = false;
  for (const p of a.picks ?? []) {
    const o = p as { escape?: boolean; selector?: unknown };
    if (o.escape) escape = true;
    else {
      // T-158 (BROW-036): secrets masked, addresses bare, a broken capture thrown away.
      const s = scrubPick(p);
      if (s) picks.push(s);
    }
  }
  return { active: a.active === true, picks, escape };
}
