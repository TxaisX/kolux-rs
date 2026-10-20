// T-325-c (CHAT-010 / CHAT-011): the agent's reply read off its terminal while a turn runs. The chat
// shows it as the live preview (`previewToShow`, `combine` in src/chat/model.ts decide when and where).
//
// What is read: the logical lines (wrapped rows joined) from the turn's start row to the cursor. The
// start row is a marker set when the chat sees the turn open; when the user's prompt echo ("> text"
// not inside the input box) sits at or above it on the screen, the read starts after the echo, so a
// reply that began before the marker is still read whole. In the alternate screen (full-screen
// programs) the whole screen is read instead, since its rows are redrawn in place.
//
// Chrome heuristic (documented, tested against fake buffers in turnRead.test.ts):
//  - anywhere: status/footer rows (`esc to interrupt`, `? for shortcuts`, `shift+tab to …`, a spinner
//    glyph then a word ending in `…`, `N% context left`, `⏵⏵` mode lines) and rows framed by `│ … │`
//    (the input box and dialogs) are dropped;
//  - at the head and the tail: blank rows, box-drawing rules (`───`, `╭──╮`, `╰──╯`) and prompt rows
//    (`>`, `❯`, `›` first) are dropped, so the input box and what sits around it never reach the reply.
// Tool output: a bullet row (`⏺`, `●`, `•`) whose text is a tool call (`Name(args)`, or Codex's
// `Ran …` / `Explored` / `Edited …` / `Called …`; a `Name(` call ends in `)` or `…`) starts a tool block, and rows starting `⎿` or `└`
// are tool output. Tool blocks never become reply text; a read that holds only tool output is
// marked `tool: true`, which the preview rule hides.
import { useEffect, useState } from "react";
import type { Terminal } from "@xterm/xterm";

/** The part of an xterm buffer line the reader uses. */
export type ReadLine = { readonly isWrapped: boolean; translateToString(trimRight?: boolean): string };
/** The part of xterm's active buffer the reader uses (fake in tests). */
export type ReadBuf = {
  readonly type: "normal" | "alternate";
  readonly length: number;
  readonly baseY: number;
  readonly cursorY: number;
  readonly viewportY: number;
  getLine(y: number): ReadLine | undefined;
};
/** Same shape as the chat's `Preview` (src/chat/model.ts). */
export type TurnPreview = { text: string; tool?: boolean };
/** A row that follows the buffer as it scrolls; `line` is -1 once trimmed off the top. */
export type TurnMark = { readonly line: number; dispose(): void };
/** A pane's terminal as the reader sees it. */
export type TurnSource = { buffer(): ReadBuf; mark(): TurnMark; onWrite(cb: () => void): () => void };

/** How far above the start marker the prompt echo is looked for. */
export const ECHO_BACK = 200;

const RULE = /^[\s─-╿]*$/;
const HAS_BOX = /[─-╿]{3,}/;
const PROMPT = /^\s*[>❯›](\s|$)/;
const FRAMED = /^\s*[│┃].*[│┃]\s*$/;
const CHROME = [
  /esc to (interrupt|cancel)/i,
  /\? for shortcuts/i,
  /shift\+tab to /i,
  /ctrl\+c to (exit|quit|interrupt)/i,
  /\d+% context left/i,
  /⏵⏵/,
  /^\s*[✻✽✢✶✳✺*·⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+\S+…/,
];
const BULLET = /^\s{0,2}([⏺●•])\s?(.*)$/;
const TOOL_CALL = /^(?:[A-Za-z][\w.:-]*(?: \([A-Z]+\))?\(.*(?:\)|…)|(?:Ran|Edited|Called) .*|Explored.*)$/;
const TOOL_OUT = /^\s*[⎿└]/;

const isRule = (l: string) => l.trim() !== "" && RULE.test(l) && HAS_BOX.test(l);
const isChrome = (l: string) => FRAMED.test(l) || CHROME.some((r) => r.test(l));
const isEdge = (l: string) => l.trim() === "" || isRule(l) || PROMPT.test(l) || isChrome(l);

/** The logical lines from row `from` to row `to` (inclusive), wrapped rows joined onto the row they
 * continue; a `from` inside a wrapped line starts at that line's first row. */
export function logicalLines(buf: ReadBuf, from: number, to: number): string[] {
  let y = Math.max(0, from);
  while (y > 0 && buf.getLine(y)?.isWrapped) y--;
  const last = Math.min(to, buf.length - 1);
  const out: string[] = [];
  for (; y <= last; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    const text = line.translateToString(false);
    if (line.isWrapped && out.length > 0) out[out.length - 1] += text;
    else out.push(text);
  }
  return out.map((l) => l.replace(/\s+$/, ""));
}

/** The row the turn's reply starts on: the row after the nearest prompt echo at or above `mark`
 * (an echo is a prompt row not directly under a box rule, which would make it the input box), else
 * `mark` itself. */
export function turnStart(buf: ReadBuf, mark: number, back = ECHO_BACK): number {
  for (let y = Math.min(mark, buf.length - 1); y >= Math.max(0, mark - back); y--) {
    const line = buf.getLine(y);
    if (!line || line.isWrapped) continue;
    const text = line.translateToString(true);
    if (!PROMPT.test(text)) continue;
    const above = y > 0 ? buf.getLine(y - 1)?.translateToString(true) ?? "" : "";
    if (isRule(above)) continue;
    return y + 1;
  }
  return mark;
}

/** Drops chrome rows anywhere and the edge rows (blank, rules, prompts) at the head and the tail. */
export function trimChrome(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  const edge = (l: string) => isEdge(l);
  // The tail first: the input box, its footer and the spinner sit below the reply.
  while (b > a && edge(lines[b - 1])) b--;
  while (a < b && edge(lines[a])) a++;
  return lines.slice(a, b).filter((l) => !isChrome(l));
}

type Block = { tool: boolean; lines: string[] };

/** Splits rows into bullet blocks; a block is tool output when its bullet names a tool call or it
 * holds `⎿` / `└` rows. Rows before the first bullet form a block of their own. */
export function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let cur: Block | null = null;
  for (const l of lines) {
    const b = BULLET.exec(l);
    if (b) {
      cur = { tool: TOOL_CALL.test(b[2].trim()), lines: [b[2]] };
      out.push(cur);
      continue;
    }
    if (!cur) {
      cur = { tool: false, lines: [] };
      out.push(cur);
    }
    if (TOOL_OUT.test(l)) {
      // a tool result under a reply bullet still marks only its own rows as tool output
      if (!cur.tool && cur.lines.some((x) => x.trim() !== "")) {
        cur = { tool: true, lines: [] };
        out.push(cur);
      } else cur.tool = true;
    }
    cur.lines.push(cur.tool ? l : l.replace(/^ {2}/, ""));
  }
  return out;
}

/** The reply text in `lines` (tool blocks left out), marked `tool` when only tool output was there. */
export function replyOf(lines: string[]): TurnPreview {
  const all = blocks(trimChrome(lines));
  const reply = all
    .filter((b) => !b.tool)
    .map((b) => b.lines.join("\n").replace(/\n{3,}/g, "\n\n").trim())
    .filter(Boolean);
  const text = reply.join("\n\n");
  return text ? { text } : { text: "", tool: all.some((b) => b.tool) };
}

/** One read of the turn: from the start (see `turnStart`) to the cursor; the whole screen in the
 * alternate buffer; from the screen's top when the marker was trimmed off (`mark` < 0). */
export function readTurn(buf: ReadBuf, mark: number): TurnPreview {
  const cursor = buf.baseY + buf.cursorY;
  if (buf.type === "alternate") return replyOf(logicalLines(buf, 0, buf.length - 1));
  const from = mark < 0 ? buf.baseY : turnStart(buf, Math.min(mark, cursor));
  return replyOf(logicalLines(buf, from, cursor));
}

// The panes' terminals by pane key; TerminalPane registers its own on mount.
const sources = new Map<number, TurnSource>();
const waiting = new Map<number, Set<() => void>>();

/** Makes a pane's terminal readable by the chat; the returned call unregisters it. */
export function registerTurnSource(paneKey: number, source: TurnSource): () => void {
  sources.set(paneKey, source);
  for (const w of [...(waiting.get(paneKey) ?? [])]) w();
  return () => {
    if (sources.get(paneKey) !== source) return;
    sources.delete(paneKey);
    for (const w of [...(waiting.get(paneKey) ?? [])]) w();
  };
}

/** Poll: one read of a pane's turn from `mark` (a buffer row), or null when the pane has no terminal. */
export function readPane(paneKey: number, mark: number): TurnPreview | null {
  const s = sources.get(paneKey);
  return s ? readTurn(s.buffer(), mark) : null;
}

/** Subscribe: marks the turn's start in the pane's terminal now and calls `onPreview` with each new
 * reading (at most once per `everyMs` while output arrives, and only when it changed). A pane whose
 * terminal is not mounted yet is picked up when it registers. The returned call stops it. */
export function watchTurn(paneKey: number, onPreview: (p: TurnPreview) => void, everyMs = 200): () => void {
  let bound: { source: TurnSource; mark: TurnMark; off: () => void } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = "";
  const read = () => {
    timer = null;
    if (!bound) return;
    const p = readTurn(bound.source.buffer(), bound.mark.line);
    const key = `${p.tool ? 1 : 0}${p.text}`;
    if (key === last) return;
    last = key;
    onPreview(p);
  };
  const unbind = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!bound) return;
    bound.off();
    bound.mark.dispose();
    bound = null;
  };
  const bind = () => {
    const source = sources.get(paneKey);
    if (bound?.source === source) return;
    unbind();
    if (!source) return;
    const mark = source.mark();
    const off = source.onWrite(() => {
      if (!timer) timer = setTimeout(read, everyMs);
    });
    bound = { source, mark, off };
    read();
  };
  let set = waiting.get(paneKey);
  if (!set) waiting.set(paneKey, (set = new Set()));
  set.add(bind);
  bind();
  return () => {
    set!.delete(bind);
    if (set!.size === 0) waiting.delete(paneKey);
    unbind();
  };
}

/** The chat side: the pane's live reply while `turnOpen`, null otherwise (CHAT-011). */
export function useTurnPreview(paneKey: number, turnOpen: boolean): TurnPreview | null {
  const [p, setP] = useState<TurnPreview | null>(null);
  useEffect(() => {
    setP(null);
    if (!turnOpen) return;
    return watchTurn(paneKey, setP);
  }, [paneKey, turnOpen]);
  return p;
}

/** An xterm terminal as a turn source. */
export function xtermSource(term: Terminal): TurnSource {
  return {
    buffer: () => term.buffer.active as unknown as ReadBuf,
    mark: () => {
      const m = term.registerMarker(0);
      if (m) return { get line() { return m.line; }, dispose: () => m.dispose() };
      const b = term.buffer.active;
      const line = b.baseY + b.cursorY;
      return { line, dispose: () => {} };
    },
    onWrite: (cb) => {
      const d = term.onWriteParsed(cb);
      return () => d.dispose();
    },
  };
}
