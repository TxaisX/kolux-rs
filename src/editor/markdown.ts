// Markdown in an editor tab (EDIT-012). The rich view is a Lexical editor showing the file as a
// document; the file's text stays in the tab's CodeMirror buffer, so saving, the unsaved marker and
// twin panes work exactly as in source view. A rich edit is turned back into markdown and only the
// changed span goes into the buffer; blocks the edit did not touch keep their exact bytes, and front
// matter stays out of the rich view (EDIT-019, planRich and rewrite). Text the rich view cannot show faithfully stays in source
// view with the reason, and so does a file over about 600 KB until the user picks Open anyway.
import { $getRoot, COMMAND_PRIORITY_CRITICAL, createEditor, PASTE_COMMAND, type LexicalEditor } from "lexical";
import { PASTE_LIMIT, refusal } from "./paste";
import { HeadingNode, QuoteNode, registerRichText } from "@lexical/rich-text";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { ListItemNode, ListNode, registerCheckList, registerList } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { $convertFromMarkdownString, $convertToMarkdownString, CHECK_LIST, registerMarkdownShortcuts, TRANSFORMERS } from "@lexical/markdown";
import { mergeRegister } from "@lexical/utils";

export const isMarkdown = (path: string) => /\.(md|markdown)$/i.test(path);

/** Files bigger than this open in source view with a banner (EDIT-012). */
export const RICH_LIMIT = 600 * 1024;

const MD = [CHECK_LIST, ...TRANSFORMERS];
const NODES = [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, CodeHighlightNode, LinkNode];
const THEME = {
  paragraph: "md-p",
  quote: "md-quote",
  heading: { h1: "md-h1", h2: "md-h2", h3: "md-h3", h4: "md-h4", h5: "md-h5", h6: "md-h6" },
  list: { ul: "md-ul", ol: "md-ol", listitem: "md-li", listitemChecked: "md-li md-checked", listitemUnchecked: "md-li md-unchecked", nested: { listitem: "md-nested" } },
  link: "md-link",
  code: "md-code",
  text: { bold: "md-bold", italic: "md-italic", strikethrough: "md-strike", code: "md-inline-code", underline: "md-underline" },
};

const fail = (e: Error) => {
  throw e;
};

/** Things Lexical's markdown import would drop or garble, as a reason for the source banner. Front
 *  matter, raw HTML and comments are not among them (EDIT-019): front matter never reaches the rich
 *  view, and HTML shows as its own text and is written back as it was. */
const LIMITS: [RegExp, string][] = [
  [/^ {0,3}\|?.*\|.*\r?\n {0,3}\|? *:?-+:? *\|/m, "tables"],
  [/!\[[^\]]*\]\(/, "images"],
  [/^ {0,3}\[[^\]^]+\]:\s/m, "reference links"],
  [/\[\^[^\]]+\]/, "footnotes"],
  [/^ {0,3}([-*_])( *\1){2,} *$/m, "horizontal rules"],
  [/^ {0,3}\S.*\r?\n {0,3}(=+|-+) *$/m, "underlined headings"],
];

/** Why the rich view cannot show this markdown, or null when it can. Code is not looked into. */
export function unsupported(text: string): string | null {
  const md = splitFront(text).body.replace(/\r\n/g, "\n");
  const prose = md.replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1/gm, "").replace(/`[^`\n]*`/g, "");
  for (const [re, what] of LIMITS) if (re.test(prose)) return `it has ${what}`;
  const back = roundTrip(md);
  if (back === null) return "it could not be read as markdown";
  if (words(back) !== words(md)) return "some of its text would be lost";
  return planRich(text) ? null : "the rich view could not match its blocks to the file";
}

const words = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");

/** Markdown in, the rich view's document: adjacent lines of a paragraph flow as one (EDIT-019). */
const load = (md: string) => $convertFromMarkdownString(md, MD, undefined, false, true);

let checker: LexicalEditor | null = null;
/** The markdown the rich view would write back for this text (null when Lexical fails on it). */
export function roundTrip(md: string): string | null {
  try {
    const ed = (checker ??= createEditor({ namespace: "kolux-md-check", nodes: NODES, onError: fail }));
    ed.update(() => load(md), { discrete: true });
    return ed.getEditorState().read(() => $convertToMarkdownString(MD));
  } catch {
    checker = null;
    return null;
  }
}

const FRONT = /^(---|\+\+\+)[ \t]*\r?\n(?:[\s\S]*?\r?\n)?\1[ \t]*(?:\r?\n|$)/;

/** A note's YAML (---) or TOML (+++) front matter, closing line included, and the body after it. */
export function splitFront(md: string): { front: string; body: string } {
  const m = FRONT.exec(md);
  const front = m ? m[0] : "";
  return { front, body: md.slice(front.length) };
}

type Line = { text: string; from: number; to: number };
/** The lines of `s` with their spans (line end not included), `\r\n` or `\n`. */
function linesOf(s: string): Line[] {
  const out: Line[] = [];
  let from = 0;
  while (from <= s.length) {
    let nl = s.indexOf("\n", from);
    if (nl < 0) nl = s.length;
    const to = nl > from && s[nl - 1] === "\r" ? nl - 1 : nl;
    out.push({ text: s.slice(from, to), from, to });
    from = nl + 1;
  }
  return out;
}
const blank = (l: Line) => l.text.trim() === "";
const shown = (md: string) => linesOf(md).filter((l) => !blank(l));

/** The file's blocks: runs of lines between blank lines, a fenced code block always kept whole. */
function blocksOf(body: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let fence: string | null = null;
  for (const l of linesOf(body)) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(l.text)?.[1];
    if (fence === null && blank(l)) continue;
    const last = out[out.length - 1];
    if (last && (fence !== null || body.slice(last.to, l.from).split("\n").length <= 2)) last.to = l.to;
    else out.push({ from: l.from, to: l.to });
    if (f && fence === null) fence = f;
    else if (f && fence !== null && f[0] === fence[0] && f.length >= fence.length) fence = null;
  }
  return out;
}

/** How the rich view's markdown maps back onto the file's own bytes. */
export type Plan = { lead: string; body: string; tail: string; crlf: boolean; blocks: { from: number; to: number; lines: string[] }[]; base: string };

/** Lines up each of the file's blocks with the lines the rich view writes for it, so a rich edit
 *  can keep every block it did not touch exactly as it is on disk. Null when they cannot be matched. */
export function planRich(md: string): Plan | null {
  const { front, body } = splitFront(md);
  const base = roundTrip(body.replace(/\r\n/g, "\n"));
  if (base === null) return null;
  const blocks = [];
  for (const b of blocksOf(body)) {
    const one = roundTrip(body.slice(b.from, b.to).replace(/\r\n/g, "\n"));
    if (one === null) return null;
    blocks.push({ ...b, lines: shown(one).map((l) => l.text) });
  }
  const want = shown(base).map((l) => l.text);
  if (blocks.flatMap((b) => b.lines).join("\n") !== want.join("\n")) return null;
  const first = blocks[0]?.from ?? body.length;
  const last = blocks[blocks.length - 1]?.to ?? body.length;
  return { lead: front + body.slice(0, first), body, tail: body.slice(last), crlf: body.includes("\r\n"), blocks, base };
}

/** The file's text for the rich view's markdown `out`: the blocks it left alone at the start and
 *  the end keep their bytes, and only what lies between them is the rich view's own text. */
export function rewrite(plan: Plan, out: string): string {
  const { blocks, body } = plan;
  const got = shown(out);
  const same = (b: Plan["blocks"][number], at: number) => b.lines.every((t, k) => got[at + k]?.text === t);
  let p = 0;
  let at = 0;
  while (p < blocks.length && same(blocks[p], at)) at += blocks[p++].lines.length;
  let s = blocks.length;
  let end = got.length;
  while (s > p && end - blocks[s - 1].lines.length >= at && same(blocks[s - 1], end - blocks[s - 1].lines.length)) end -= blocks[--s].lines.length;
  const midFrom = at > 0 ? got[at - 1].to : 0;
  const midTo = end < got.length ? got[end].from : out.length;
  const eol = (t: string) => (plan.crlf ? t.replace(/\r?\n/g, "\r\n") : t);
  const raw = out.slice(midFrom, midTo);
  const before = /^(?:[ \t]*\r?\n)*/.exec(raw)![0];
  const after = /(?:\r?\n[ \t]*)*$/.exec(raw.slice(before.length))![0];
  const core = raw.slice(before.length, raw.length - after.length);
  // Next to a kept block the file's own gap stays (the blank lines it had), not the rich view's.
  const gap = (i: number) => body.slice(blocks[i - 1].to, blocks[i].from);
  let mid: string;
  if (!core) mid = p > 0 && s < blocks.length ? gap(p) : "";
  else mid = (p === 0 ? "" : p < blocks.length ? gap(p) : eol(before)) + eol(core) + (s === blocks.length ? "" : s > 0 ? gap(s) : eol(after));
  const head = p > 0 ? body.slice(blocks[0].from, blocks[p - 1].to) : "";
  const foot = s < blocks.length ? body.slice(blocks[s].from, blocks[blocks.length - 1].to) : "";
  return plan.lead + head + mid + foot + plan.tail;
}

/** The one replacement that turns `a` into `b`: the span between their common start and end. */
export function changeBetween(a: string, b: string): { from: number; to: number; insert: string } | null {
  if (a === b) return null;
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return { from: s, to: a.length - e, insert: b.slice(s, b.length - e) };
}

/** EDIT-008: a paste past the limit is refused in the rich view too, and so is one past the rich
 * view's own size limit (FIX-1) (true = refused, toast given). */
export function refusePaste(event: ClipboardEvent | KeyboardEvent | InputEvent, refuse: (text: string) => void): boolean {
  const text = "clipboardData" in event ? (event.clipboardData?.getData("text/plain") ?? "") : "";
  if (text.length <= RICH_LIMIT) return false;
  event.preventDefault();
  refuse(text.length > PASTE_LIMIT ? refusal(text.length) : richRefusal(text.length));
  return true;
}

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB` : `${Math.round(n / 1024)} KB`);

/** EDIT-008 (FIX-1): the toast for a paste over the rich view's own size limit (the size it opens a
 * file at), short of the hard limit: Lexical takes a paste in one go, so a bigger one would freeze
 * the window; the source view takes it in pieces. */
export function richRefusal(length: number): string {
  const over = size(length) === size(RICH_LIMIT) ? "it is just" : `${size(length)} is`;
  return `Paste refused in the rich view: ${over} over the ${size(RICH_LIMIT)} it takes in one paste. Paste it in source view instead. Nothing was pasted.`;
}

export type Rich = { editor: LexicalEditor; show: (md: string) => void; destroy: () => void };

/** Starts the rich view in `el`; `onEdit` gets the whole markdown after each edit by the user;
 * `onRefuse` shows the toast for a paste past the limit (EDIT-008). */
export function mountRich(el: HTMLElement, md: string, onEdit: (md: string) => void, onRefuse: (text: string) => void = () => {}): Rich {
  const editor = createEditor({ namespace: "kolux-md", nodes: NODES, onError: fail, theme: THEME });
  editor.setRootElement(el);
  let last = "";
  const off = mergeRegister(
    registerRichText(editor),
    registerHistory(editor, createEmptyHistoryState(), 300),
    registerList(editor),
    registerCheckList(editor),
    registerMarkdownShortcuts(editor, MD),
    editor.registerCommand(PASTE_COMMAND, (event) => refusePaste(event, onRefuse), COMMAND_PRIORITY_CRITICAL),
    editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return; // the caret moved, nothing more
      const now = editorState.read(() => $convertToMarkdownString(MD));
      if (now === last) return;
      last = now;
      if (!tags.has("kolux-load")) onEdit(now);
    }),
  );
  const show = (text: string) =>
    editor.update(
      () => {
        load(text);
        $getRoot().selectStart(); // the caret starts at the top, not after the last line
      },
      { discrete: true, tag: ["kolux-load", "history-merge"] },
    );
  show(md);
  // Leaving the rich view hands over the latest typing at once, so a save straight after has it.
  const flush = () => editor.update(() => {}, { discrete: true });
  el.addEventListener("focusout", flush);
  return {
    editor,
    show,
    destroy: () => {
      flush();
      el.removeEventListener("focusout", flush);
      off();
      editor.setRootElement(null);
    },
  };
}
