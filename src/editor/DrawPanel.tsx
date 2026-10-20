// EDIT-029 / EDIT-030 (T-235-b): the floating panel under the block the caret is in, drawing a mermaid fence or
// the maths in a paragraph. Nothing in the note changes; the panel sits below the block, never over it, and
// takes no clicks of its own beyond scrolling (pointer-events stay on so a long diagram can scroll).
import { useEffect, useState } from "react";
import type { LexicalEditor } from "lexical";
import { diagramPanel, drawnAtCaret, mathHtml, type Drawn } from "./richDraw";
import { loadRenderers, watchRenderers } from "./diagrams";

type Panel = { top: number; left: number; width: number; body: { html: string } | { frame: { srcdoc: string; ratio: string; maxWidth: number } } | { error: string } };

export default function DrawPanel({ editor }: { editor: LexicalEditor | null }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [libs, setLibs] = useState(0);
  useEffect(() => {
    void loadRenderers();
    return watchRenderers(() => setLibs((n) => n + 1));
  }, []);
  useEffect(() => {
    if (!editor) return;
    let alive = true;
    let seq = 0;
    let last = "";
    const refresh = () => {
      const d: Drawn | null = drawnAtCaret(editor);
      const sig = d ? `${d.key}|${d.kind === "mermaid" ? d.src : d.items.map((i) => i.raw).join("\n")}|${libs}` : "";
      if (sig === last) return;
      last = sig;
      const mine = ++seq;
      const el = d ? editor.getElementByKey(d.key) : null;
      if (!d || !el) return setPanel(null);
      const r = el.getBoundingClientRect();
      const at = { top: r.bottom + 4, left: r.left, width: r.width };
      if (d.kind === "math") return setPanel({ ...at, body: { html: mathHtml(d.items) } });
      void diagramPanel(d.src, true).then((out) => {
        if (!alive || mine !== seq) return;
        setPanel({ ...at, body: "error" in out ? out : { frame: out } });
      });
    };
    refresh();
    const off = editor.registerUpdateListener(refresh);
    return () => {
      alive = false;
      off();
    };
  }, [editor, libs]);
  if (!panel) return null;
  const style = { top: panel.top, left: panel.left, width: panel.width };
  return (
    <div className="rich-draw" style={style} aria-label="Drawn preview">
      {"html" in panel.body && <div className="md-preview md-math-block" dangerouslySetInnerHTML={{ __html: panel.body.html }} />}
      {"error" in panel.body && <div className="md-diagram-error">{panel.body.error}</div>}
      {"frame" in panel.body && (
        <iframe className="md-diagram" sandbox="" referrerPolicy="no-referrer" title="Diagram" srcDoc={panel.body.frame.srcdoc} style={{ aspectRatio: panel.body.frame.ratio, maxWidth: panel.body.frame.maxWidth }} />
      )}
    </div>
  );
}
