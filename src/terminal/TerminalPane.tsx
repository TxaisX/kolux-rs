// One terminal pane: a shell on the Rust side, drawn by xterm.js here. Typing goes to the PTY,
// output comes back as events, the pane follows the window size, and Close ends the program.
// The card and its header follow design/DESIGN.md section 7: status icon, agent mark, title,
// branch chip, program, status word; then gauge, more, expand, split, close on the right.
import { useEffect, useRef, useState } from "react";
import { headerOf } from "./status";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { attachRenderer, type RendererMode } from "./renderer";
import { decodeOutput, endedLabel, type ExitEvent, type OutputEvent } from "./codec";
import { currentTerminal, monoFont, TERMINAL_EVENT } from "../theme";
import { folderName } from "../projects/model";
import { withoutRules } from "../launch/seats";
import { modelOf } from "../settings/routing";
import { CheckCircle, Close, Dots, Expand, Plus, Spinner , SplitRight} from "../chrome/icons";
import VendorMark, { type Agent } from "../chrome/VendorMark";
import PlusMenu, { programWord, type AgentInfo } from "../launch/PlusMenu";
import { useKeymap } from "../keys/KeymapContext";
import { matchEvent } from "../keys/keymap";

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
  /** SET-027: the user's environment variables for this agent. */
  env?: [string, string][];
  onRunning?: (running: boolean) => void;
  /** TERM-030: true while this pane waits on the user, so the window can cycle to it. */
  onNeedsYou?: (needs: boolean) => void;
  /** TERM-118: the program rang the terminal bell. */
  onBell?: () => void;
  /** TERM-118: finished or rang while not in view; the pane carries the mark until viewed. */
  unread?: boolean;
  /** TERM-045: the session id once it runs, so the window can ask whether closing would stop a program. */
  onPty?: (id: number) => void;
  /** The session failed to start (SESS-024: the window drops the pane rather than leaving it blank). */
  onFailed?: (error: string) => void;
  /** A job title from the seat (SESS-024) wins over the workspace name. */
  title?: string;
  /** SESS-006: the shell picked in the create menu names itself in the header. */
  shellName?: string;
  /** An opening prompt typed in once the agent is ready (SESS-051 typed route). */
  typed?: string;
  /** Names a pane outside any workspace: "Terminal N". */
  number?: number;
  onFocus?: () => void;
  /** Close was asked for; the window decides (TERM-045) and drops the pane, which ends its program. */
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
  card?: { expanded: boolean; onToggle: () => void };
};

export default function TerminalPane({ hidden = false, cwd = null, branch = null, focused = false, agent = "shell", program = null, args = [], env, onRunning, onNeedsYou, onBell, unread = false, onPty, onFailed, title: jobTitle, typed, shellName, number, onFocus, onClose, agents = [], launching = false, onLaunch, defaultId, onSetDefault, onChoose, onSplit, card }: Props) {
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
  const pty = useRef(onPty);
  pty.current = onPty;
  const failed = useRef(onFailed);
  failed.current = onFailed;

  useEffect(() => {
    report.current?.(status.kind === "running");
    if (status.kind === "running") pty.current?.(status.id);
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
      theme: currentTerminal(),
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
        for (const text of queued.splice(0)) term.paste(text);
      }, 1500);
    };
    // TERM-068: a paste arrives through this pane's own text area, so it can only land in the
    // pane that has focus, and the browser hands over the clipboard in the same tick, so there is
    // no moment in which the target could change. A paste made while the opening prompt is still
    // owed waits for it. The paste chords are left to the browser instead of xterm.
    const queued: string[] = [];
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text") ?? "";
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!text) return;
      if (pending !== null) queued.push(text);
      else term.paste(text);
    };
    term.textarea?.addEventListener("paste", onPaste, true);
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
        const id = await invoke<number>("terminal_spawn", { cols: term.cols, rows: term.rows, cwd, program, args, env: env ?? null });
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
    // SET-003: open terminals follow a theme change without being reopened.
    const recolour = () => {
      term.options.theme = currentTerminal();
    };
    window.addEventListener(TERMINAL_EVENT, recolour);

    return () => {
      alive = false;
      window.removeEventListener(TERMINAL_EVENT, recolour);
      clearTimeout(quiet);
      observer.disconnect();
      unlisteners.forEach((u) => u());
      const id = idRef.current;
      if (id !== null) invoke("terminal_kill", { id }).catch(() => {});
      choice.dispose();
      term.dispose();
    };
  }, []);

  // Close asks the window (TERM-045 may confirm first); dropping the pane ends its program
  // through the cleanup above (TERM-014).
  const close = () => onClose?.();

  // TERM-020/021: a plain shell reads as a terminal with a neutral status; an agent reads
  // Working (working tone) while its program is up, Done (done tone, with its age) after it
  // ends well. What it needs (permission, waiting, blocked) comes from the status hooks (T-025).
  const { word, tone, icon, age, needsYou } = headerOf(agent, status.kind, status.kind === "ended" ? status.code : undefined, false, finishedAt, now);
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
  // SET-028: a pane started with a model (a seat's pick or a worker's tier) names it.
  const model = agent === "shell" ? null : modelOf(args);

  return (
    <section className={`pane${focused ? " focused" : ""}${glow || unread ? " glow" : ""}${unread ? " unread" : ""}${card ? " card" : ""}${card?.expanded ? " expanded" : ""}`} hidden={hidden} aria-label={`${title} pane`} onMouseDown={onFocus} data-agent={agent}>
      <header className="pane-head">
        <span className={`st ${icon}`} role="img" aria-label={`status: ${word}`} title={[word, drawing].filter(Boolean).join(" · ")}>
          {icon === "working" ? <Spinner size={11} /> : <CheckCircle size={12} />}
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
        {/* SESS-025: the start line shown back leaves out the rules block of a side-by-side launch. */}
        <span className="word" title={program ? [program, ...args.map(withoutRules)].join(" ") : undefined}>
          {shellName ?? programWord(agent)}
          {model && ` · ${model}`}
        </span>
        <span className={`status ${tone}`}>{word}</span>
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
      <div ref={host} className="pane-body" />
    </section>
  );
}
