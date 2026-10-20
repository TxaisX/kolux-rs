// EDIT-014 (T-234-b): note links in source view. [text](address) and [[note]] are underlined in a markdown file's
// text, and Ctrl/Cmd+click follows them the way it does in the rich view and the preview (a name that fits more
// than one file is dashed and says so instead of guessing). The span finding is pure so it is tested alone.
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { resolveLink, wikiLinks, wikiMatches, wikiTarget, type Action } from "./noteLinks";

export type Span = { from: number; to: number } & ({ kind: "md"; href: string } | { kind: "wiki"; name: string });

const MD_LINK = /(?<!!)\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

/** Every link span in one line of text, in order, offsets within the line. Images are not links. */
export function linkSpans(line: string): Span[] {
  if (!line.includes("[")) return [];
  const spans: Span[] = [...line.matchAll(MD_LINK)].map((m) => ({ from: m.index!, to: m.index! + m[0].length, kind: "md" as const, href: m[1] }));
  for (const w of wikiLinks(line)) spans.push({ from: w.from, to: w.to, kind: "wiki", name: w.name });
  // a [[note]] sitting inside a markdown link is counted once, by the markdown link
  return spans.filter((s, i) => !spans.some((o, j) => j !== i && o.from <= s.from && o.to >= s.to && o.to - o.from > s.to - s.from)).sort((a, b) => a.from - b.from);
}

/** The span a column falls in (the end counts as outside). */
export const spanAt = (line: string, col: number): Span | null => linkSpans(line).find((s) => col >= s.from && col < s.to) ?? null;

export type Resolved = { action: Action } | { toast: string };

/** What following a span does: the action for a markdown link; for [[note]] the one note it names, else a toast. */
export function followSpan(s: Span, note: string, root: string | null, files: string[]): Resolved {
  if (s.kind === "md") {
    let href = s.href;
    try {
      href = decodeURI(href);
    } catch {
      /* keep as written */
    }
    return { action: resolveLink(href, note, root) };
  }
  const { note: name, heading } = wikiTarget(s.name);
  const { matches, ambiguous } = wikiMatches(files, name);
  if (matches.length === 0) return { toast: `No note named ${name}.` };
  if (ambiguous) return { toast: `${matches.length} notes are named ${name}; use a link with the folder to pick one.` };
  const rel = matches[0].replace(/\\/g, "/");
  const path = /^[a-z]:\//i.test(rel) || rel.startsWith("/") ? rel : root ? `${root.replace(/[\\/]+$/, "")}/${rel}` : rel;
  return { action: { kind: "file", path, ...(heading ? { heading } : {}), how: "preview" } };
}

export type SourceLinkOpts = { note: string; root: string | null; files: () => string[]; onLink: (a: Action, shift: boolean) => void; onToast: (t: string) => void };

/** The CodeMirror extension: underlines and Mod+click. `opts` is read at use, so the file list can arrive later. */
export function sourceLinks(opts: () => SourceLinkOpts): Extension {
  const build = (view: EditorView): DecorationSet => {
    const b = new RangeSetBuilder<Decoration>();
    const files = opts().files();
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to; ) {
        const line = view.state.doc.lineAt(pos);
        for (const s of linkSpans(line.text)) {
          const shared = s.kind === "wiki" && wikiMatches(files, wikiTarget(s.name).note).ambiguous;
          b.add(line.from + s.from, line.from + s.to, Decoration.mark({ class: shared ? "cm-note-link cm-note-link-shared" : "cm-note-link" }));
        }
        pos = line.to + 1;
      }
    }
    return b.finish();
  };
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
  const click = EditorView.domEventHandlers({
    mousedown(e, view) {
      if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return false;
      const line = view.state.doc.lineAt(pos);
      const s = spanAt(line.text, pos - line.from);
      if (!s) return false;
      const o = opts();
      const r = followSpan(s, o.note, o.root, o.files());
      e.preventDefault();
      if ("toast" in r) o.onToast(r.toast);
      else if (r.action.kind !== "none" && r.action.kind !== "here") o.onLink(r.action, e.shiftKey);
      return true;
    },
  });
  return [plugin, click, EditorView.baseTheme({ ".cm-note-link": { textDecoration: "underline", textUnderlineOffset: "2px" }, ".cm-note-link-shared": { textDecorationStyle: "dashed" } })];
}
