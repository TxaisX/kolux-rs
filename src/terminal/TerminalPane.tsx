// One terminal pane: a shell on the Rust side, drawn by xterm.js here. Typing goes to the PTY,
// output comes back as events, the pane follows the window size, and Close ends the program.
// The card and its header follow design/DESIGN.md section 7: status icon, agent mark, title,
// branch chip, program, status word; then gauge, more, expand, split, close on the right.
import { useEffect, useRef, useState } from "react";
import { crewLabel, crewLine, headerOf, type Crew } from "./status";
import type { Chip } from "../board/chip";
import type { AgentState } from "../projects/rows";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { attachRenderer, type RendererMode } from "./renderer";
import { decodeOutput, endedLabel, type ExitEvent, type OutputEvent } from "./codec";
import { monoFont, terminalTheme } from "../theme";
import { folderName } from "../projects/model";
import { Close, Dots, Expand, Plus, SplitRight, StatusGlyph } from "../chrome/icons";
import VendorMark, { type Agent } from "../chrome/VendorMark";
import PlusMenu, { programWord, type AgentInfo } from "../launch/PlusMenu";
import { useKeymap } from "../keys/KeymapContext";
import { matchEvent } from "../keys/keymap";
import { attachPaste } from "./paste";
import { stopLine, type StopInfo } from "./notify";

type Status = { kind: "starting" } | { kind: "running"; id: number } | { kind: "ended"; code: number | null } | { kind: "failed"; error: string };

type Props = {
  /** Kept mounted but not shown: another workspace is in front (PROJ-066). */
  hidden?: boolean;
  cwd?: string | null;
  branch?: string | null;
  focused?: boolean;
  agent?: Agent;
  /** The program to run instead of the shell (an agent's command), with its arguments. */
  program?: string | null;
  args?: string[];
  onRunning?: (running: boolean) => void;
  /** TERM-030: true while this pane waits on the user, so the window can cycle to it. */
  onNeedsYou?: (needs: boolean) => void;
  /** STAT-001: the pane's last hook-fed state; wins over the title guess while the program runs. */
  hook?: AgentState;
  /** STAT-026: the sub-agents and teammates under this session, shown beside the status word. */
  crew?: Crew;
  /** STAT-022: why the agent halted while `hook` is blocked; the header's tooltip says it. */
  stop?: StopInfo;
  /** TERM-118: the program rang the terminal bell. */
  onBell?: () => void;
  /** TERM-118: finished or rang while not in view; the pane carries the mark until viewed. */
  unread?: boolean;
  /** The session failed to start (SESS-024: the window drops the pane rather than leaving it blank). */
  onFailed?: (error: string) => void;
  /** A job title from the seat (SESS-024) wins over the workspace name. */
  title?: string;
  /** An opening prompt typed in once the agent is ready (SESS-051 typed route). */
  typed?: string;
  /** Names a pane outside any workspace: "Terminal N". */
  number?: number;
  onFocus?: () => void;
  /** Called after Close ended the program, so the window can drop the pane. */
  onClose?: () => void;
  /** The plus menu behind the header's "+" button. */
  agents?: AgentInfo[];
  launching?: boolean;
  onLaunch?: (agent: AgentInfo) => void;
  defaultId?: string;
  onSetDefault?: (id: string) => void;
  onChoose?: () => void;
  /** TERM-006: the header split button opens a shell beside this pane, in the same folder. */
  onSplit?: () => void;
  /** VIEW-026: on the Board this pane is a card; expanded shows the live terminal inside it. */
  card?: {
    expanded: boolean;
    onToggle: () => void;
    /** VIEW-023: the card's chip: the word, the line and the newest file written; null for a plain shell. */
    chip?: Chip | null;
    /** VIEW-025: approve or deny from the card. */
    onAnswer?: (approve: boolean) => void;
    /** VIEW-023: the Board column (status lane) this card sits in. */
    column?: number;
  };
};

export default function TerminalPane({ hidden = false, cwd = null, branch = null, focused = false, agent = "shell", program = null, args = [], onRunning, onNeedsYou, hook, crew, stop, onBell, unread = false, onFailed, title: jobTitle, typed, number, onFocus, onClose, agents = [], launching = false, onLaunch, defaultId, onSetDefault, onChoose, onSplit, card }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "starting" });
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [glow, setGlow] = useState(false); // TERM-023: finished while not focused
  const [now, setNow] = useState(() => Date.now());
  const [renderer, setRenderer] = useState<RendererMode | null>(null);
  const [plusAt, setPlusAt] = useState<{ top: number; right: number } | null>(null);
  const idRef = useRef<number | null>(null);
  const keymap = useKeymap();
  const keys = useRef(keymap);
  keys.current = keymap;
  const report = useRef(onRunning);
  report.current = onRunning;
  const bell = useRef(onBell);
  bell.current = onBell;
  const failed = useRef(onFailed);
  failed.current = onFailed;

  useEffect(() => {
    report.current?.(status.kind === "running");
  }, [status.kind]);
  // TERM-023: an agent that finished while this pane was not focused glows until it is; the age
  // next to Done refreshes each minute. The glow is static (no animation).
  useEffect(() => {
    if (status.kind !== "ended") return;
    setFinishedAt(Date.now());
    if (!focused && agent !== "shell" && !status.code) setGlow(true); // finished well, not stopped
  }, [status.kind]);
  useEffect(() => {
    if (focused) setGlow(false);
  }, [focused]);
  useEffect(() => {
    if (finishedAt === null) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, [finishedAt]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: monoFont,
      fontSize: 13,
      theme: terminalTheme(),
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    const choice = attachRenderer<WebglAddon>(term, () => new WebglAddon());
    setRenderer(choice.mode);
    choice.onFallback(() => setRenderer("dom"));
    fit.fit();

    let alive = true;
    let ended = false;
    const unlisteners: UnlistenFn[] = [];
    const write = (data: string) => {
      const id = idRef.current;
      if (id !== null && !ended) invoke("terminal_write", { id, data }).catch(() => {});
    };
    term.onData(write);
    term.onBell(() => bell.current?.());
    // SESS-051: a typed-route prompt goes in once the program has drawn its screen and gone
    // quiet. ponytail: "ready" is the first 1.5 s of silence after some output; SESS-032 owns the
    // real readiness rule and replaces this timer.
    let pending = typed?.trim() ? typed.trim() : null;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const sawOutput = () => {
      if (pending === null) return;
      clearTimeout(quiet);
      quiet = setTimeout(() => {
        if (pending === null || !alive) return;
        write(pending + "\r");
        pending = null;
        pasting.flush();
      }, 1500);
    };
    // TERM-068 lives in paste.ts (tested there); the paste chords are left to the browser instead of xterm.
    const pasting = attachPaste(term.textarea, (text) => term.paste(text), () => pending !== null);
    term.attachCustomKeyEventHandler((e) => !(e.type === "keydown" && matchEvent(keys.current, e, ["terminal"])?.id === "terminal.paste"));

    (async () => {
      unlisteners.push(
        await listen<OutputEvent>("terminal-output", (e) => {
          if (e.payload.id !== idRef.current) return;
          term.write(decodeOutput(e.payload.data));
          sawOutput();
        }),
        await listen<ExitEvent>("terminal-exit", (e) => {
          if (e.payload.id !== idRef.current) return;
          ended = true;
          term.write(`\r\n\x1b[90m[process ${endedLabel(e.payload.code)}]\x1b[0m\r\n`);
          setStatus({ kind: "ended", code: e.payload.code });
        }),
      );
      if (!alive) return;
      try {
        const id = await invoke<number>("terminal_spawn", { cols: term.cols, rows: term.rows, cwd, program, args, paneKey: number });
        if (!alive) {
          invoke("terminal_kill", { id }).catch(() => {});
          return;
        }
        idRef.current = id;
        setStatus({ kind: "running", id });
        term.focus();
      } catch (err) {
        setStatus({ kind: "failed", error: String(err) });
        failed.current?.(String(err));
      }
    })();

    const resize = () => {
      // A hidden pane has no size; fitting it would shrink the program's terminal to nothing.
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      fit.fit();
      const id = idRef.current;
      if (id !== null && !ended) invoke("terminal_resize", { id, cols: term.cols, rows: term.rows }).catch(() => {});
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    return () => {
      alive = false;
      clearTimeout(quiet);
      observer.disconnect();
      unlisteners.forEach((u) => u());
      const id = idRef.current;
      if (id !== null) invoke("terminal_kill", { id }).catch(() => {});
      choice.dispose();
      pasting.detach();
      term.dispose();
    };
  }, []);

  // Close ends the program (TERM-014; the "ask first" step comes with its own task) and tells
  // the window, which drops the pane unless it is the last one.
  const close = () => {
    const id = idRef.current;
    if (id !== null) invoke("terminal_kill", { id }).catch(() => {});
    onClose?.();
  };

  // TERM-020/021: a plain shell reads as a terminal with a neutral status; an agent reads
  // Working (working tone) while its program is up, Done (done tone, with its age) after it
  // ends well or when its hook says the turn is over; what it needs comes from the hooks (T-025).
  useEffect(() => {
    if (hook === "done") setFinishedAt((t) => t ?? Date.now());
    else if (hook === "working") setFinishedAt(null);
  }, [hook]);
  const header = headerOf(agent, status.kind, status.kind === "ended" ? status.code : undefined, false, finishedAt, now, hook);
  const { word, tone, glyph, age, needsYou } = header;
  const explain = header.state === "blocked" && stop ? `${stopLine(stop)}.` : header.explain;
  const needs = useRef(onNeedsYou);
  needs.current = onNeedsYou;
  useEffect(() => {
    needs.current?.(needsYou);
  }, [needsYou]);
  const drawing = renderer === "webgl" ? "GPU renderer" : renderer === "dom" ? "plain renderer" : "";
  // The seat's job title names the pane; else the workspace folder (an agent launch's creature
  // name); else "Terminal N" (SESS-024).
  const title = jobTitle || (cwd ? folderName(cwd) : `Terminal${number ? ` ${number}` : ""}`);
  const agentLabel = agent === "shell" ? "Plain shell" : programWord(agent);

  return (
    <section className={`pane${focused ? " focused" : ""}${glow || unread ? " glow" : ""}${unread ? " unread" : ""}${card ? " card" : ""}${card?.expanded ? " expanded" : ""}`} hidden={hidden} aria-label={`${title} pane`} onMouseDown={onFocus} data-agent={agent} style={card?.column ? { gridColumn: card.column } : undefined}>
      <header className="pane-head">
        <span className={`st ${tone || "idle"}`} role="img" aria-label={`status: ${word}`} data-tip={[explain, drawing].filter(Boolean).join(" · ")}>
          <StatusGlyph glyph={glyph} size={glyph === "spinner" ? 11 : 12} />
        </span>
        <span className="agent-mark" title={agentLabel}>
          <VendorMark agent={agent} size={13} />
        </span>
        <span className="title" title={cwd ?? undefined}>
          {title}
        </span>
        {branch && (
          <span className="chip" title={branch}>
            {branch}
          </span>
        )}
        <span className="word" title={program ? [program, ...args].join(" ") : undefined}>
          {programWord(agent)}
        </span>
        <span className={`status ${tone}`} data-tip={explain}>
          {word}
        </span>
        {crew && crew.length > 0 && (
          <span className="crew" title={crew.map(crewLine).join("\n")}>
            {crewLabel(crew)}
          </span>
        )}
        {age && (
          <span className="age" title="when the agent finished">
            {age}
          </span>
        )}
        <span className="right">
          <span className="gauge" title="Context used (agents only)">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--gauge-track)" strokeWidth="2" />
            </svg>
            0%
          </span>
          <button className="ib" title="Pane menu (not built yet)">
            <Dots size={12} />
          </button>
          <button
            className="ib"
            onClick={card?.onToggle}
            aria-expanded={card ? card.expanded : undefined}
            title={card ? (card.expanded ? "Collapse: the terminal goes back to its grid slot" : "Expand: show this session's live terminal in the card") : "Expand (not built yet)"}
          >
            <Expand size={12} />
          </button>
          {onSplit && (
            <button className="ib" onClick={onSplit} title="Split right: a shell in the same folder (Ctrl+Shift+D; Alt+Shift+D splits down)">
              <SplitRight size={12} />
            </button>
          )}
          <button
            className="ib"
            title="New session: start an agent in a new pane"
            aria-haspopup="menu"
            aria-expanded={plusAt !== null}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPlusAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
            }}
          >
            <Plus size={12} />
          </button>
          <button className="ib" onClick={close} title="Close pane (Ctrl+W): ends the program">
            <Close size={12} />
          </button>
        </span>
      </header>
      {plusAt && (
        <PlusMenu
          agents={agents}
          defaultId={defaultId}
          onSetDefault={onSetDefault}
          busy={launching}
          style={{ top: plusAt.top, right: plusAt.right }}
          onChoose={
            onChoose &&
            (() => {
              setPlusAt(null);
              onChoose();
            })
          }
          onClose={() => setPlusAt(null)}
          onPick={(a) => {
            setPlusAt(null);
            onLaunch?.(a);
          }}
        />
      )}
      {card?.chip && (
        <div className={`chip-row ${card.chip.lane}`}>
          <span className="chip-word">{card.chip.word}</span>
          {card.chip.line && (
            <span className="chip-line" title={card.chip.line}>
              {card.chip.line}
            </span>
          )}
          {card.chip.file && (
            <span className="chip-file" title={card.chip.file} data-path={card.chip.file}>
              {folderName(card.chip.file)}
            </span>
          )}
          {card.chip.answer && card.onAnswer && (
            <span className="chip-actions">
              <button className="btn primary" onClick={() => card.onAnswer?.(true)} title="Approve: the agent carries on">
                Approve
              </button>
              <button className="btn" onClick={() => card.onAnswer?.(false)} title="Deny: the agent is told no">
                Deny
              </button>
            </span>
          )}
        </div>
      )}
      <div ref={host} className="pane-body" />
    </section>
  );
}
