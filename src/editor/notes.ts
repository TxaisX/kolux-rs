// GIT-042: review notes on Markdown documents. A note quotes the text selected in the rich view,
// the source editor or the preview, and all notes copy as one Markdown block for an agent.

import { ageLabel } from "../terminal/status";

export type Note = { path: string; line: number; time: number; quote: string; note: string };
export type Draft = { path: string; line: number; quote: string };

/** Settings key; false turns the Markdown review tools off. */
export const REVIEW_FIELD = "markdownReviewNotes";
export const reviewOn = (settings: Record<string, unknown>) => settings[REVIEW_FIELD] !== false;

/** The line (from 1) the selected text starts on. The rich view and the preview drop markup, so a
 * miss tries the first three words before giving up on line 1. */
export function lineOf(text: string, quote: string): number {
  const first = quote.trim().split("\n")[0].trim();
  for (const key of [quote, first, first.split(/\s+/).slice(0, 3).join(" ")]) {
    const at = key.trim() ? text.indexOf(key) : -1;
    if (at >= 0) return text.slice(0, at).split("\n").length;
  }
  return 1;
}

/** What the note popover starts from; null when nothing is selected, so the shortcut does nothing. */
export function noteDraft(path: string, text: string, selected: string, line?: number): Draft | null {
  const quote = selected.trim();
  if (!quote) return null;
  return { path, line: line ?? lineOf(text, quote), quote };
}

/** All notes as one Markdown block: per file, by line, then by time, each quoting its selection. */
export function notesMarkdown(notes: Note[]): string {
  const sorted = [...notes].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.time - b.time);
  const out = ["# Review notes", ""];
  let file: string | null = null;
  for (const n of sorted) {
    if (n.path !== file) out.push(`## ${(file = n.path)}`, "");
    out.push(`Line ${n.line}:`, ...n.quote.split("\n").map((l) => `> ${l}`), "", n.note.trim(), "");
  }
  return out.join("\n");
}

/** Each open editor or preview tab registers how to read its selection, keyed by pane. */
export type Picked = { draft: Draft; x: number; y: number };
export const selections = new Map<number, () => Picked | null>();

/** The selection inside one element, with where to put the popover. */
export function domPick(host: Element | null, path: string, text: string): Picked | null {
  const sel = window.getSelection();
  if (!host || !sel || sel.rangeCount === 0 || !host.contains(sel.anchorNode)) return null;
  const draft = noteDraft(path, text, sel.toString());
  if (!draft) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  return { draft, x: r.left, y: r.bottom };
}

/** EDIT-020: one agent the notes can go to, with how long since its state last changed. */
export type SendTarget = { key: number; label: string; since: string };

/** EDIT-020: the agent panes running in this worktree (`here` checks the folder and the live
 * terminal), the most recent state change first. */
export function sendTargets<P extends { key: number; agent: string; kind?: string; cwd: string | null }>(panes: P[], here: (p: P) => boolean, changed: Record<number, { at: number } | undefined>, now: number, name: (p: P) => string): SendTarget[] {
  return panes
    .filter((p) => !p.kind && p.agent !== "shell" && here(p))
    .sort((a, b) => (changed[b.key]?.at ?? 0) - (changed[a.key]?.at ?? 0))
    .map((p) => {
      const at = changed[p.key]?.at;
      return { key: p.key, label: name(p), since: at === undefined ? "no change yet" : `changed ${ageLabel(at, now)}` };
    });
}
