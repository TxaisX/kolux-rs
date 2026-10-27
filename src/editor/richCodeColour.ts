// After-list row 494: colours in the rich view's code blocks. highlight.js finds the words; the page paints
// them with the CSS Custom Highlight API (as the note find does), so the editor's own text nodes are never
// touched and the fence text stays exactly what was typed. Colours are theme tokens in editor-extras.css.
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import type { LexicalEditor } from "lexical";
import { canonLanguage, codeBlocks } from "./richCode";

const LANGUAGES = { bash, c, cpp, csharp, css, diff, go, ini, java, javascript, json, markdown, powershell, python, rust, sql, typescript, xml, yaml };
for (const [name, def] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, def);

/** The fence label (see richCode.ts) to the highlight.js language; a label not here is left plain. */
const LANG: Record<string, string> = { html: "xml", toml: "ini", ...Object.fromEntries(Object.keys(LANGUAGES).map((n) => [n, n])) };

export type Kind = "comment" | "keyword" | "string" | "number" | "title" | "type" | "meta" | "add" | "del";
export const KINDS: Kind[] = ["comment", "keyword", "string", "number", "title", "type", "meta", "add", "del"];
export type Span = { start: number; end: number; kind: Kind };

/** highlight.js scope (first class of a span, without `hljs-`) to the colour kind; wrappers like `function` are left out. */
const SCOPE: Record<string, Kind> = {
  comment: "comment", quote: "comment", doctag: "comment",
  keyword: "keyword", "selector-tag": "keyword", "meta-keyword": "keyword", operator: "keyword",
  string: "string", regexp: "string", "meta-string": "string", symbol: "string", "template-tag": "string",
  number: "number", literal: "number", bullet: "number",
  title: "title", section: "title", name: "title",
  type: "type", built_in: "type", attr: "type", attribute: "type", property: "type", variable: "type", "selector-class": "type", "selector-id": "type",
  meta: "meta", tag: "meta",
  addition: "add", deletion: "del",
};

/** A block longer than this stays plain: highlighting runs on every edit frame. */
const MAX_CHARS = 20000;
const ENTITY: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'" };
const TOKEN = /<span class="([^"]*)">|<\/span>|&(?:amp|lt|gt|quot|#x27|#39);|[^<&]+/g;

/** Offsets of the coloured words in `code` for a fence language; [] for a language it does not know. Only offsets leave here, never highlight.js's markup. */
export function codeSpans(code: string, lang: string | null | undefined): Span[] {
  const id = LANG[canonLanguage(lang)];
  if (!id || !code || code.length > MAX_CHARS) return [];
  let html: string;
  try {
    html = hljs.highlight(code, { language: id, ignoreIllegals: true }).value;
  } catch {
    return [];
  }
  const out: Span[] = [];
  const stack: (Kind | null)[] = [];
  let pos = 0;
  for (const m of html.matchAll(TOKEN)) {
    const t = m[0];
    if (m[1] !== undefined) stack.push(SCOPE[m[1].split(" ")[0].replace(/^hljs-/, "")] ?? null);
    else if (t === "</span>") stack.pop();
    else {
      const len = (t[0] === "&" ? ENTITY[t] : t).length;
      const kind = [...stack].reverse().find((k) => k !== null);
      if (kind) {
        const last = out[out.length - 1];
        if (last && last.kind === kind && last.end === pos) last.end = pos + len;
        else out.push({ start: pos, end: pos + len, kind });
      }
      pos += len;
    }
  }
  return pos === code.length ? out : []; // the markup did not map back onto the code: paint nothing
}

/** The text of a code element as the editor holds it (a line break is one newline) with a way back to DOM points. */
export function textSegments(root: Node): { text: string; point(offset: number, edge: "start" | "end"): { node: Node; offset: number } | null } {
  const segs: { node: Node; start: number; len: number }[] = [];
  let text = "";
  const walk = (n: Node) => {
    for (const ch of Array.from(n.childNodes)) {
      if (ch.nodeType === 3) {
        const data = (ch as Text).data;
        segs.push({ node: ch, start: text.length, len: data.length });
        text += data;
      } else if (ch.nodeName === "BR") text += "\n";
      else walk(ch);
    }
  };
  walk(root);
  return {
    text,
    point(o, edge) {
      const s = edge === "start" ? segs.find((g) => g.start + g.len > o) : [...segs].reverse().find((g) => g.start < o);
      return s ? { node: s.node, offset: Math.min(s.len, Math.max(0, o - s.start)) } : null;
    },
  };
}

// One registry entry per kind for every rich view's blocks, so the page's CSS names each once.
const painted = new Map<LexicalEditor, Map<Kind, Range[]>>();
function repaint() {
  const reg = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights;
  if (!reg || typeof Highlight === "undefined") return;
  for (const k of KINDS) {
    const all = [...painted.values()].flatMap((p) => p.get(k) ?? []);
    if (all.length) reg.set(`kx-hl-${k}`, new Highlight(...all));
    else reg.delete(`kx-hl-${k}`);
  }
}

/** Keeps the code blocks of this rich view coloured after every edit; returns the cleanup. */
export function registerCodeColour(editor: LexicalEditor): () => void {
  if (typeof document === "undefined" || typeof requestAnimationFrame === "undefined") return () => undefined; // no page to paint
  let frame = 0;
  const cache = new Map<string, { sig: string; spans: Span[] }>();
  const run = () => {
    frame = 0;
    const per = new Map<Kind, Range[]>();
    const live = new Set<string>();
    for (const b of codeBlocks(editor)) {
      if (!b.el) continue;
      live.add(b.key);
      const seg = textSegments(b.el);
      const sig = `${b.language}\0${seg.text}`;
      let hit = cache.get(b.key);
      if (hit?.sig !== sig) cache.set(b.key, (hit = { sig, spans: codeSpans(seg.text, b.language) }));
      for (const s of hit.spans) {
        const a = seg.point(s.start, "start");
        const z = seg.point(s.end, "end");
        if (!a || !z) continue;
        const r = document.createRange();
        r.setStart(a.node, a.offset);
        r.setEnd(z.node, z.offset);
        if (r.collapsed) continue;
        per.set(s.kind, [...(per.get(s.kind) ?? []), r]);
      }
    }
    for (const k of cache.keys()) if (!live.has(k)) cache.delete(k);
    painted.set(editor, per);
    repaint();
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(run);
  };
  const off = editor.registerUpdateListener(schedule);
  schedule();
  return () => {
    off();
    cancelAnimationFrame(frame);
    painted.delete(editor);
    repaint();
  };
}
