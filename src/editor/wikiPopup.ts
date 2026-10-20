// EDIT-014 (T-234-b): the [[ popup of the rich view. Typing two opening square brackets lists the notes of the
// worktree; more typing narrows the list; Enter, Tab or a click turns the choice into a link to that note
// (relative to the note being edited, spaces written as %20). A name that fits more than one file is flagged
// in the list with how many files share it, so the right one is picked by its folder. A link never spans a
// line break, so the popup only follows brackets on the same line as the caret.
import {
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
import { $createLinkNode } from "@lexical/link";
import { mergeRegister } from "@lexical/utils";
import { wikiMatches, wikiSuggest } from "./noteLinks";

/** The text typed after `[[` when the caret is in one (on the same line, no closing brackets yet), else null.
 *  `before` is the line's text up to the caret. */
export function wikiQuery(before: string): string | null {
  const m = /\[\[([^[\]\n|]{0,60})$/.exec(before);
  return m ? m[1] : null;
}

const baseName = (f: string) => (f.split(/[\\/]/).pop() ?? f).replace(/\.(md|markdown|mdx)$/i, "");

/** The path of `target` as a link from the note `from` (both worktree-relative, either slash): up with `../`
 *  from the note's folder, spaces and brackets written as %-codes so the markdown link survives them. */
export function relativeLink(from: string, target: string): string {
  const a = from.replace(/\\/g, "/").split("/").slice(0, -1);
  const b = target.replace(/\\/g, "/").split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i].toLowerCase() === b[i].toLowerCase()) i++;
  const rel = [...Array<string>(a.length - i).fill(".."), ...b.slice(i)].join("/");
  return rel.replace(/[ ()[\]]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export type WikiItem = { path: string; name: string; /** how many notes carry this name (more than one = flagged) */ same: number };
export type WikiView = { query: string; items: WikiItem[]; index: number };

/** The list for what was typed: matches first by name, flagged when the name is shared. */
export function wikiItems(files: string[], typed: string, limit = 20): WikiItem[] {
  return wikiSuggest(files, typed, limit).map((path) => ({ path, name: baseName(path), same: wikiMatches(files, baseName(path)).matches.length }));
}

/** Replaces the typed `[[word` before the caret with a link to `target` (call from outside an update). False when the caret is not after one. */
export function insertWikiLink(editor: LexicalEditor, notePath: string, target: string): boolean {
  let done = false;
  editor.update(
    () => {
      const sel = $getSelection();
      if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
      const n = sel.anchor.getNode();
      if (!$isTextNode(n)) return;
      const before = n.getTextContent().slice(0, sel.anchor.offset);
      const q = wikiQuery(before);
      if (q === null) return;
      const start = sel.anchor.offset - q.length - 2;
      n.spliceText(start, q.length + 2, "", true);
      const link = $createLinkNode(relativeLink(notePath, target));
      link.append($createTextNode(baseName(target)));
      sel.insertNodes([link]);
      done = true;
    },
    { discrete: true },
  );
  return done;
}

/** Watches the caret for `[[` and keeps the popup's state, like the slash menu: arrows move, Enter or Tab picks, Escape closes it. */
export function createWiki(editor: LexicalEditor, files: () => string[], notePath: string, show: (v: WikiView | null) => void) {
  let view: WikiView | null = null;
  let dismissed: string | null = null;
  const set = (v: WikiView | null) => {
    view = v;
    show(v);
  };
  const look = () => {
    const sel = $getSelection();
    let q: string | null = null;
    if ($isRangeSelection(sel) && sel.isCollapsed()) {
      const n = sel.anchor.getNode();
      if ($isTextNode(n) && n.getParent()?.getType() !== "code") q = wikiQuery(n.getTextContent().slice(0, sel.anchor.offset));
    }
    if (q === null) {
      dismissed = null;
      if (view) set(null);
      return;
    }
    if (dismissed === q) return;
    dismissed = null;
    const items = wikiItems(files(), q);
    if (items.length === 0) {
      if (view) set(null);
      return;
    }
    if (!view || view.query !== q) set({ query: q, items, index: 0 });
  };
  const move = (d: number) => {
    if (!view) return false;
    set({ ...view, index: (view.index + d + view.items.length) % view.items.length });
    return true;
  };
  const pick = (path?: string) => {
    const chosen = path ?? view?.items[view.index]?.path;
    set(null);
    return chosen ? insertWikiLink(editor, notePath, chosen) : false;
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
