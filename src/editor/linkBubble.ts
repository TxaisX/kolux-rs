// EDIT-014 (T-234-b): the hover bubble of a link in the rich view (open, edit, copy). The pure parts live here:
// where the bubble goes, which edited addresses are accepted, and the one edit that rewrites a link's address.
import { $getNearestNodeFromDOMNode, $getNodeByKey, type LexicalEditor } from "lexical";
import { $isLinkNode } from "@lexical/link";

type Box = { left: number; top: number; right: number; bottom: number };

/** Where the bubble sits: just above the link, flipped below when there is no room above, kept inside the window sideways. */
export function bubblePlace(link: Box, size: { w: number; h: number }, view: { w: number; h: number }, gap = 6): { left: number; top: number; above: boolean } {
  const above = link.top - size.h - gap >= 0;
  const top = above ? link.top - size.h - gap : Math.min(link.bottom + gap, Math.max(0, view.h - size.h));
  const left = Math.max(8, Math.min(link.left, view.w - size.w - 8));
  return { left, top, above };
}

/** The address an edit may write: trimmed, spaces written as %20, never empty, never a script-bearing scheme. Null when refused. */
export function cleanHref(raw: string): string | null {
  const t = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (t === "" || /[\u0000-\u001f\u007f]/.test(t)) return null;
  if (/^(javascript|data|vbscript|blob):/i.test(t.replace(/\s+/g, ""))) return null;
  return t.replace(/ /g, "%20");
}

/** The node key of the link a DOM element belongs to (null when it is not inside one). */
export function linkKeyAt(editor: LexicalEditor, el: Element): string | null {
  return editor.getEditorState().read(() => {
    let n = $getNearestNodeFromDOMNode(el);
    while (n) {
      if ($isLinkNode(n)) return n.getKey();
      n = n.getParent();
    }
    return null;
  });
}

/** Rewrites the address of the link with this key as one edit (true when it changed). */
export function setLinkUrl(editor: LexicalEditor, key: string, href: string): boolean {
  const url = cleanHref(href);
  if (url === null) return false;
  let done = false;
  editor.update(
    () => {
      const n = $getNodeByKey(key);
      if (!n || !$isLinkNode(n) || n.getURL() === url) return;
      n.setURL(url);
      done = true;
    },
    { discrete: true },
  );
  return done;
}
