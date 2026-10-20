// EDIT-006 (T-316-b): the editor minimap, a thin picture of the whole file beside the text. CodeMirror has no
// minimap of its own and a package would be a new dependency, so this draws one small canvas straight from
// the document: one row of the picture per few lines, a bar as long and as indented as the text there, and a
// lighter box over the part the editor is showing. Click or drag on it to scroll. It is off unless
// Settings > General switches it on (editorMinimap); EditorPane adds this extension only then.
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Extension, Text } from "@codemirror/state";

export type MiniRow = { indent: number; length: number };

/** The picture's width in CSS pixels and how tall one row is. */
export const MINI = { width: 76, row: 2, maxCols: 100 } as const;

/** Squeezes the document into at most `rows` rows. A row stands for a few lines: its bar starts at the
 *  least indented of them and is as long as the longest (tabs count as four columns). */
export function sampleDoc(doc: Text, rows: number): MiniRow[] {
  const n = doc.lines;
  const count = Math.max(0, Math.min(n, Math.floor(rows)));
  const out: MiniRow[] = [];
  for (let r = 0; r < count; r++) {
    const a = Math.floor((r * n) / count) + 1;
    const b = Math.max(a, Math.floor(((r + 1) * n) / count));
    const step = Math.max(1, Math.ceil((b - a + 1) / 8)); // look at up to 8 lines of a big bucket
    let indent = Infinity;
    let length = 0;
    for (let i = a; i <= b; i += step) {
      const text = doc.line(i).text.replace(/\t/g, "    ");
      const body = text.trimStart();
      if (!body) continue;
      const lead = text.length - body.length;
      indent = Math.min(indent, lead);
      length = Math.max(length, lead + body.trimEnd().length);
    }
    out.push(indent === Infinity ? { indent: 0, length: 0 } : { indent: Math.min(indent, MINI.maxCols), length: Math.min(length, MINI.maxCols) });
  }
  return out;
}

/** Picture pixels per page pixel: the picture is as tall as its rows, the page as tall as the taller of the
 *  text and the window. */
const scale = (viewHeight: number, docHeight: number, pictureHeight: number) => pictureHeight / Math.max(docHeight, viewHeight, 1);

/** The lit box over the part of the picture the editor shows (all heights in pixels). */
export function viewBox(scrollTop: number, viewHeight: number, docHeight: number, pictureHeight: number): { top: number; height: number } {
  const k = scale(viewHeight, docHeight, pictureHeight);
  const height = Math.max(6, Math.min(pictureHeight, viewHeight * k));
  return { top: Math.min(Math.max(0, pictureHeight - height), Math.max(0, scrollTop * k)), height };
}

/** Where to scroll so the part under a click at `y` of the picture sits in the middle of the editor. */
export function scrollForClick(y: number, viewHeight: number, docHeight: number, pictureHeight: number): number {
  const k = scale(viewHeight, docHeight, pictureHeight) || 1;
  return Math.max(0, Math.min(Math.max(0, docHeight - viewHeight), y / k - viewHeight / 2));
}

class Minimap {
  dom = document.createElement("div");
  canvas = document.createElement("canvas");
  frame = 0;
  down = false;
  constructor(readonly view: EditorView) {
    this.dom.className = "cm-minimap";
    this.dom.setAttribute("aria-hidden", "true");
    this.dom.append(this.canvas);
    view.dom.append(this.dom);
    const jump = (e: PointerEvent) => {
      const h = this.dom.clientHeight;
      const s = view.scrollDOM;
      s.scrollTop = scrollForClick(e.clientY - this.dom.getBoundingClientRect().top, s.clientHeight, s.scrollHeight, h);
    };
    this.dom.addEventListener("pointerdown", (e) => {
      this.down = true;
      this.dom.setPointerCapture?.(e.pointerId);
      jump(e);
      e.preventDefault();
    });
    this.dom.addEventListener("pointermove", (e) => this.down && jump(e));
    this.dom.addEventListener("pointerup", () => (this.down = false));
    this.dom.addEventListener("pointercancel", () => (this.down = false));
    view.scrollDOM.addEventListener("scroll", this.later);
    this.later();
  }
  later = () => {
    if (!this.frame) this.frame = requestAnimationFrame(() => ((this.frame = 0), this.draw()));
  };
  update(u: ViewUpdate) {
    if (u.docChanged || u.geometryChanged || u.viewportChanged) this.later();
  }
  draw() {
    const h = this.dom.clientHeight;
    if (h <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const c = this.canvas;
    if (c.width !== Math.round(MINI.width * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(MINI.width * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${MINI.width}px`;
      c.style.height = `${h}px`;
    }
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, MINI.width, h);
    const ink = getComputedStyle(this.view.dom).color || "#888";
    const rows = sampleDoc(this.view.state.doc, Math.floor(h / MINI.row));
    g.fillStyle = ink;
    g.globalAlpha = 0.45;
    const px = (MINI.width - 4) / MINI.maxCols;
    rows.forEach((r, i) => r.length > 0 && g.fillRect(2 + r.indent * px, i * MINI.row, Math.max(1, (r.length - r.indent) * px), MINI.row - 0.5));
    const s = this.view.scrollDOM;
    const box = viewBox(s.scrollTop, s.clientHeight, s.scrollHeight, Math.min(h, rows.length * MINI.row));
    g.globalAlpha = 0.16;
    g.fillRect(0, box.top, MINI.width, box.height);
    g.globalAlpha = 1;
  }
  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.view.scrollDOM.removeEventListener("scroll", this.later);
    this.dom.remove();
  }
}

/** The minimap, ready to drop into a Compartment. */
export const minimap = (): Extension => [
  ViewPlugin.fromClass(Minimap),
  EditorView.theme({
    ".cm-scroller": { marginRight: `${MINI.width}px` },
    ".cm-minimap": { position: "absolute", top: "0", right: "0", bottom: "0", width: `${MINI.width}px`, cursor: "pointer", touchAction: "none", borderLeft: "1px solid var(--line-subtle, rgba(128,128,128,0.25))" },
  }),
];
