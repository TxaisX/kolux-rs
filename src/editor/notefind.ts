// EDIT-017: find (and, in the rich view, replace) inside a rendered note. Matches are found per
// block of the rendered page (a paragraph, a heading, a list item, a code block), so a match can
// cross bold or link boundaries but never runs from one block into the next. They are marked with
// the browser's highlight registry, which leaves the page itself untouched (the rich view's
// editor owns its DOM). Whole-word matching counts letters, digits and marks of every script as
// word characters, astral ones included.
import { $createRangeSelection, $getNearestNodeFromDOMNode, $isTextNode, $setSelection, type LexicalEditor } from "lexical";

export type FindOptions = { matchCase: boolean; wholeWord: boolean };

const WORD = "[\\p{L}\\p{N}\\p{M}_]";

/** Where `query` occurs in `text`, as [start, end) offsets. An empty query finds nothing. */
export function findIn(text: string, query: string, opts: FindOptions): [number, number][] {
  if (!query) return [];
  const body = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(opts.wholeWord ? `(?<!${WORD})${body}(?!${WORD})` : body, opts.matchCase ? "gu" : "giu");
  const out: [number, number][] = [];
  for (const m of text.matchAll(re)) out.push([m.index, m.index + m[0].length]);
  return out;
}

const BLOCK = "p,h1,h2,h3,h4,h5,h6,li,pre,blockquote,td,th,code.md-code";

/** The matches inside a rendered note, as DOM ranges in reading order. */
export function rangesIn(root: HTMLElement | null, query: string, opts: FindOptions): Range[] {
  if (!root || !query) return [];
  const out: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let block: Element | null = null;
  let nodes: Text[] = [];
  const flush = () => {
    if (!nodes.length) return;
    const starts: number[] = [];
    let text = "";
    for (const n of nodes) {
      starts.push(text.length);
      text += n.data;
    }
    const at = (offset: number, end: boolean): [Text, number] => {
      // The node holding `offset`; an end offset on a boundary stays in the earlier node.
      let i = nodes.length - 1;
      while (i > 0 && (end ? starts[i] >= offset : starts[i] > offset)) i--;
      return [nodes[i], offset - starts[i]];
    };
    for (const [s, e] of findIn(text, query, opts)) {
      const r = document.createRange();
      r.setStart(...at(s, false));
      r.setEnd(...at(e, true));
      out.push(r);
    }
    nodes = [];
  };
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const b = n.parentElement?.closest(BLOCK) ?? root;
    if (b !== block) {
      flush();
      block = b;
    }
    nodes.push(n);
  }
  flush();
  return out;
}

// One registry entry for every pane's matches, so the page's CSS can name it once.
const painted = new Map<number, { all: Range[]; current: Range | null }>();
function repaint() {
  const reg = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights;
  if (!reg || typeof Highlight === "undefined") return;
  const all = [...painted.values()];
  reg.set("kx-find", new Highlight(...all.flatMap((p) => p.all)));
  reg.set("kx-find-current", new Highlight(...all.flatMap((p) => (p.current ? [p.current] : []))));
}

/** Marks pane `id`'s matches, `current` among them standing out; no ranges clears the pane. */
export function paint(id: number, ranges: Range[], current: number) {
  if (ranges.length) painted.set(id, { all: ranges, current: ranges[current] ?? null });
  else painted.delete(id);
  repaint();
}

/** Puts `text` in place of each range in the rich view, as one undo step. */
export function replaceInRich(editor: LexicalEditor, ranges: Range[], text: string) {
  if (!ranges.length) return;
  editor.update(
    () => {
      // Last first, so the places of the earlier ones do not move.
      for (const r of [...ranges].reverse()) {
        const a = $getNearestNodeFromDOMNode(r.startContainer);
        const b = $getNearestNodeFromDOMNode(r.endContainer);
        if (!$isTextNode(a) || !$isTextNode(b)) continue;
        const sel = $createRangeSelection();
        sel.anchor.set(a.getKey(), r.startOffset, "text");
        sel.focus.set(b.getKey(), r.endOffset, "text");
        $setSelection(sel);
        sel.insertText(text);
      }
    },
    { discrete: true },
  );
}
