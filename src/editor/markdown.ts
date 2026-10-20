// Markdown in an editor tab (EDIT-012). The rich view is a Lexical editor showing the file as a
// document; the file's text stays in the tab's CodeMirror buffer, so saving, the unsaved marker and
// twin panes work exactly as in source view. A rich edit is turned back into markdown and only the
// changed span goes into the buffer. Text the rich view cannot show faithfully stays in source
// view with the reason, and so does a file over about 600 KB until the user picks Open anyway.
import { $getRoot, COMMAND_PRIORITY_CRITICAL, createEditor, PASTE_COMMAND, type LexicalEditor } from "lexical";
import { PASTE_LIMIT, refusal } from "./paste";
import { HeadingNode, QuoteNode, registerRichText } from "@lexical/rich-text";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { ListItemNode, ListNode, registerCheckList, registerList } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { $convertFromMarkdownString, $convertToMarkdownString, CHECK_LIST, registerMarkdownShortcuts, TRANSFORMERS, type Transformer } from "@lexical/markdown";
import { mergeRegister } from "@lexical/utils";
import { registerTable, TABLE, TABLE_NODES } from "./richTable";
import { registerListKeys } from "./richFormat";
import { registerRichKeys } from "./richKeys";
import { createSlash, type SlashView } from "./slashMenu";
import { createWiki, type WikiView } from "./wikiPopup";
import { DETAILS_NODES, makeDetails, withoutSections } from "./richDetails";

export const isMarkdown = (path: string) => /\.(md|markdown)$/i.test(path);

/** Files bigger than this open in source view with a banner (EDIT-012). */
export const RICH_LIMIT = 600 * 1024;

// EDIT-010 (T-234-b): tables are read and written as markdown but not made by typing shortcuts.
const KEYS = [CHECK_LIST, ...TRANSFORMERS];
// EDIT-057 (T-237-b): the collapsible section is read and written as the note's own <details> block.
const MD: Transformer[] = [makeDetails(() => MD), TABLE, ...KEYS];
const NODES = [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, CodeHighlightNode, LinkNode, ...TABLE_NODES, ...DETAILS_NODES];
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

/** Things Lexical's markdown import would drop or garble, as a reason for the source banner. */
const LIMITS: [RegExp, string][] = [
  [/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "front matter"],
  [/<!--/, "HTML comments"],
  [/<\/?[a-z][\w-]*(\s[^<>]*)?\/?>/i, "HTML"],
  [/!\[[^\]]*\]\(/, "images"],
  [/^ {0,3}\[[^\]^]+\]:\s/m, "reference links"],
  [/\[\^[^\]]+\]/, "footnotes"],
  [/^ {0,3}([-*_])( *\1){2,} *$/m, "horizontal rules"],
  [/^ {0,3}\S.*\r?\n {0,3}(=+|-+) *$/m, "underlined headings"],
];

/** Why the rich view cannot show this markdown, or null when it can. Code is not looked into. */
export function unsupported(md: string): string | null {
  const prose = withoutSections(md.replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1/gm, "")).replace(/`[^`\n]*`/g, "");
  for (const [re, what] of LIMITS) if (re.test(prose)) return `it has ${what}`;
  const back = roundTrip(md);
  if (back === null) return "it could not be read as markdown";
  return words(back) === words(md) ? null : "some of its text would be lost";
}

const words = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");

/** The markdown the rich view would write back for this text (null when Lexical fails on it). */
export function roundTrip(md: string): string | null {
  try {
    const ed = createEditor({ namespace: "kolux-md-check", nodes: NODES, onError: fail });
    ed.update(() => $convertFromMarkdownString(md, MD), { discrete: true });
    return ed.getEditorState().read(() => $convertToMarkdownString(MD));
  } catch {
    return null;
  }
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
export function refusePaste(event: ClipboardEvent | KeyboardEvent | InputEvent, refuse: (text: string) => void, held = 0): boolean {
  const text = "clipboardData" in event ? (event.clipboardData?.getData("text/plain") ?? "") : "";
  // FIX-5 (council P1 AFTER 4): the limit is on the note the paste would make, so `held` (what the
  // note already holds) counts too; two pastes each under the limit cannot add up past it.
  if (held + text.length <= RICH_LIMIT) return false;
  event.preventDefault();
  refuse(text.length > PASTE_LIMIT ? refusal(text.length) : richRefusal(text.length, held));
  return true;
}

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB` : `${Math.round(n / 1024)} KB`);

/** EDIT-008 (FIX-1): the toast for a paste over the rich view's own size limit (the size it opens a
 * file at), short of the hard limit: Lexical takes a paste in one go, so a bigger one would freeze
 * the window; the source view takes it in pieces. */
export function richRefusal(length: number, held = 0): string {
  if (held > 0 && length <= RICH_LIMIT) {
    const lead = size(held + length) === size(RICH_LIMIT) ? "just over" : `${size(held + length)}, over`;
    return `Paste refused in the rich view: the note would be ${lead} the ${size(RICH_LIMIT)} the rich view takes. Paste it in source view instead. Nothing was pasted.`;
  }
  const over = size(length) === size(RICH_LIMIT) ? "it is just" : `${size(length)} is`;
  return `Paste refused in the rich view: ${over} over the ${size(RICH_LIMIT)} it takes in one paste. Paste it in source view instead. Nothing was pasted.`;
}

export type Rich = { editor: LexicalEditor; show: (md: string) => void; destroy: () => void; pickSlash: (id?: string) => boolean; pickWiki: (path?: string) => boolean };

/** The [[ note popup (EDIT-014): the notes of the worktree, the note being edited, and where the popup state goes. */
export type WikiOpts = { files: () => string[]; notePath: string; show: (v: WikiView | null) => void };

/** Starts the rich view in `el`; `onEdit` gets the whole markdown after each edit by the user;
 * `onRefuse` shows the toast for a paste past the limit (EDIT-008). */
export function mountRich(el: HTMLElement, md: string, onEdit: (md: string, prev: string) => void, onRefuse: (text: string) => void = () => {}, onSlash: (v: SlashView | null) => void = () => {}, wikiOpts?: WikiOpts): Rich {
  const editor = createEditor({ namespace: "kolux-md", nodes: NODES, onError: fail, theme: THEME });
  editor.setRootElement(el);
  let last = "";
  const slash = createSlash(editor, onSlash);
  const wiki = wikiOpts ? createWiki(editor, wikiOpts.files, wikiOpts.notePath, wikiOpts.show) : null;
  const off = mergeRegister(
    slash.destroy,
    wiki ? wiki.destroy : () => undefined,
    registerListKeys(editor),
    registerRichKeys(editor),
    registerRichText(editor),
    registerHistory(editor, createEmptyHistoryState(), 300),
    registerList(editor),
    registerCheckList(editor),
    registerTable(editor),
    registerMarkdownShortcuts(editor, KEYS),
    editor.registerCommand(PASTE_COMMAND, (event) => refusePaste(event, onRefuse, last.length), COMMAND_PRIORITY_CRITICAL),
    editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return; // the caret moved, nothing more
      const now = editorState.read(() => $convertToMarkdownString(MD));
      if (now === last) return;
      const prev = last;
      last = now;
      if (!tags.has("kolux-load")) onEdit(now, prev);
    }),
  );
  const show = (text: string) =>
    editor.update(
      () => {
        $convertFromMarkdownString(text, MD);
        $getRoot().selectStart(); // the caret starts at the top, not after the last line
      },
      { discrete: true, tag: ["kolux-load", "history-merge"] },
    );
  show(md);
  return {
    editor,
    show,
    pickSlash: slash.pick,
    pickWiki: (p) => wiki?.pick(p) ?? false,
    destroy: () => {
      off();
      editor.setRootElement(null);
    },
  };
}
