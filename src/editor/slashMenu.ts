// EDIT-010 (T-234-b): the slash menu of the rich markdown view. Typing a slash at the start of a line or
// after a space opens a list of things to insert; more typing narrows it, and each entry also answers
// to its other names (typing "h1" finds Heading 1, "todo" finds Task list). Arrow keys move, Enter or
// Tab picks, Escape closes it and leaves the typed text alone. Choosing an entry removes the typed
// slash and its word first, then inserts the block.
import {
  $createParagraphNode,
  $createLineBreakNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
} from "lexical";
import { $createCodeNode } from "@lexical/code";
import { mergeRegister } from "@lexical/utils";
import { applyFormat, type RichAction } from "./richFormat";
import { $insertTable } from "./richTable";

export type SlashEntry = { id: string; label: string; names: string[]; hint: string; group: "Blocks" | "Insert" | "Emoji" };

const EMOJI: [string, string, string[]][] = [
  ["smile", "\u{1F604}", ["happy", "grin"]],
  ["thumbsup", "\u{1F44D}", ["yes", "ok", "plus one"]],
  ["check", "✅", ["done", "tick"]],
  ["cross", "❌", ["no", "wrong"]],
  ["warning", "⚠️", ["careful", "caution"]],
  ["fire", "\u{1F525}", ["hot"]],
  ["rocket", "\u{1F680}", ["ship", "launch"]],
  ["bulb", "\u{1F4A1}", ["idea", "light"]],
  ["eyes", "\u{1F440}", ["look", "watch"]],
  ["heart", "❤️", ["love"]],
  ["party", "\u{1F389}", ["tada", "celebrate"]],
  ["bug", "\u{1F41B}", ["insect"]],
];

export const SLASH_ENTRIES: SlashEntry[] = [
  { id: "h1", label: "Heading 1", names: ["h1", "title", "#"], hint: "Big section heading", group: "Blocks" },
  { id: "h2", label: "Heading 2", names: ["h2", "subtitle", "##"], hint: "Medium section heading", group: "Blocks" },
  { id: "h3", label: "Heading 3", names: ["h3", "subheading", "###"], hint: "Small section heading", group: "Blocks" },
  { id: "bullet", label: "Bulleted list", names: ["ul", "list", "bullets", "unordered"], hint: "A list with dots", group: "Blocks" },
  { id: "numbered", label: "Numbered list", names: ["ol", "ordered", "steps", "1."], hint: "A list with numbers", group: "Blocks" },
  { id: "check", label: "Task list", names: ["todo", "checklist", "checkbox", "tasks"], hint: "Boxes to tick", group: "Blocks" },
  { id: "quote", label: "Quote", names: ["blockquote", "cite", ">"], hint: "An indented quotation", group: "Blocks" },
  { id: "code", label: "Code block", names: ["code", "snippet", "fence", "pre"], hint: "Monospace lines with a language label", group: "Blocks" },
  { id: "table", label: "Table", names: ["grid", "rows", "columns"], hint: "3 by 3, header row first", group: "Insert" },
  { id: "mermaid", label: "Diagram", names: ["mermaid", "flowchart", "graph", "chart"], hint: "A mermaid code fence", group: "Insert" },
  { id: "math", label: "Maths block", names: ["math", "latex", "equation", "formula", "katex"], hint: "A block between two dollar lines", group: "Insert" },
  ...EMOJI.map(([n, ch, other]): SlashEntry => ({ id: `emoji:${ch}`, label: `${ch} ${n}`, names: [`:${n}:`, "emoji", ...other], hint: "Emoji", group: "Emoji" })),
];

/** The word after a slash that starts a line or follows a space, ending at the caret; null when the
 *  caret is not in one. `before` is the text of the line up to the caret. */
export function slashQuery(before: string): string | null {
  const m = /(?:^|\s)\/([^\s/]{0,24})$/.exec(before);
  return m ? m[1] : null;
}

const norm = (s: string) => s.toLowerCase();

/** The entries that fit what was typed, best first: label starts with it, another name starts with
 *  it, label holds it, another name holds it. An empty word lists everything in menu order. */
export function matchSlash(query: string, entries: SlashEntry[] = SLASH_ENTRIES): SlashEntry[] {
  const q = norm(query.trim());
  if (!q) return entries;
  const rank = (e: SlashEntry): number => {
    const label = norm(e.label);
    const names = e.names.map(norm);
    if (label.startsWith(q) || label.split(/\s+/).some((w) => w.startsWith(q))) return 0;
    if (names.some((n) => n.startsWith(q))) return 1;
    if (label.includes(q)) return 2;
    if (names.some((n) => n.includes(q))) return 3;
    return 9;
  };
  return entries
    .map((e, i) => ({ e, r: rank(e), i }))
    .filter((x) => x.r < 9)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.e);
}

/** Removes the typed slash and word before the caret (call inside an editor update); `trim` also
 *  drops the space before it when the word ended the line, so a block does not leave "intro " behind. */
function $eraseSlash(trim: boolean): boolean {
  const sel = $getSelection();
  if (!$isRangeSelection(sel) || !sel.isCollapsed()) return false;
  const n = sel.anchor.getNode();
  if (!$isTextNode(n)) return false;
  const before = n.getTextContent().slice(0, sel.anchor.offset);
  const q = slashQuery(before);
  if (q === null) return false;
  const start = sel.anchor.offset - q.length - 1;
  const space = trim && start > 0 && n.getTextContent()[start - 1] === " " && sel.anchor.offset === n.getTextContentSize() ? 1 : 0;
  n.spliceText(start - space, q.length + 1 + space, "", true);
  return true;
}

const FORMAT = new Set<string>(["h1", "h2", "h3", "bullet", "numbered", "check", "quote"]);

/** Inserts one entry at the caret (the typed slash is removed first). Returns false for an unknown id. */
export function runSlash(editor: LexicalEditor, id: string): boolean {
  const known = SLASH_ENTRIES.some((e) => e.id === id);
  if (!known) return false;
  editor.update(() => void $eraseSlash(!id.startsWith("emoji:")), { discrete: true, tag: "history-merge" });
  if (FORMAT.has(id)) return applyFormat(editor, id as RichAction);
  editor.update(
    () => {
      const sel = $getSelection();
      if (!$isRangeSelection(sel)) return;
      if (id === "table") {
        $insertTable(3, 3);
      } else if (id === "code" || id === "mermaid") {
        const top = sel.anchor.getNode().getTopLevelElementOrThrow();
        const code = $createCodeNode(id === "mermaid" ? "mermaid" : "");
        if (top.isEmpty() && top.getType() === "paragraph") top.replace(code);
        else top.insertAfter(code);
        code.selectStart();
      } else if (id === "math") {
        const top = sel.anchor.getNode().getTopLevelElementOrThrow();
        const p = $createParagraphNode();
        p.append($createTextNode("$$"), $createLineBreakNode(), $createLineBreakNode(), $createTextNode("$$"));
        if (top.isEmpty() && top.getType() === "paragraph") top.replace(p);
        else top.insertAfter(p);
        p.select(2, 2);
      } else if (id.startsWith("emoji:")) {
        sel.insertText(id.slice(6));
      }
    },
    { discrete: true },
  );
  return true;
}

export type SlashView = { query: string; items: SlashEntry[]; index: number };

/** Watches the caret for a slash word and keeps the menu's state. `show` gets the view (null = closed);
 *  the owner draws it and calls `pick` on a click. While the menu is open the arrow keys, Enter, Tab and
 *  Escape belong to it. */
export function createSlash(editor: LexicalEditor, show: (v: SlashView | null) => void) {
  let view: SlashView | null = null;
  let dismissed: string | null = null; // the "/word" Escape closed, kept shut until the text changes
  const set = (v: SlashView | null) => {
    view = v;
    show(v);
  };
  const look = () => {
    const sel = $getSelection();
    let q: string | null = null;
    if ($isRangeSelection(sel) && sel.isCollapsed()) {
      const n = sel.anchor.getNode();
      if ($isTextNode(n) && n.getParent()?.getType() !== "code") q = slashQuery(n.getTextContent().slice(0, sel.anchor.offset));
    }
    if (q === null) {
      dismissed = null;
      if (view) set(null);
      return;
    }
    if (dismissed === q) return;
    dismissed = null;
    const items = matchSlash(q);
    if (items.length === 0) {
      if (view) set(null);
      return;
    }
    const keep = view && view.query === q ? Math.min(view.index, items.length - 1) : 0;
    if (!view || view.query !== q) set({ query: q, items, index: keep });
  };
  const move = (d: number) => {
    if (!view) return false;
    set({ ...view, index: (view.index + d + view.items.length) % view.items.length });
    return true;
  };
  const pick = (id?: string) => {
    const chosen = id ?? view?.items[view.index]?.id;
    set(null);
    return chosen ? runSlash(editor, chosen) : false;
  };
  const off = mergeRegister(
    editor.registerUpdateListener(({ editorState }) => editorState.read(look)),
    editor.registerCommand(KEY_ARROW_DOWN_COMMAND, (e) => (move(1) ? (e.preventDefault(), true) : false), COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(KEY_ARROW_UP_COMMAND, (e) => (move(-1) ? (e.preventDefault(), true) : false), COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(KEY_ENTER_COMMAND, (e) => (view ? (e?.preventDefault(), pick(), true) : false), COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(KEY_TAB_COMMAND, (e) => (view ? (e.preventDefault(), pick(), true) : false), COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        if (!view) return false;
        dismissed = view.query;
        set(null);
        return true;
      },
      COMMAND_PRIORITY_CRITICAL,
    ),
  );
  return { pick, view: () => view, destroy: off };
}
