// One terminal pane: a shell on the Rust side, drawn by xterm.js here. Typing goes to the PTY,
// output comes back as events, the pane follows the window size, and Close ends the program.
// The card and its header follow design/DESIGN.md section 7: status icon, agent mark, title,
// branch chip, program, status word; then gauge, more, expand, split, close on the right.
import { useEffect, useRef, useState } from "react";
import { branchChip, crewLabel, crewLine, headerOf, type Crew } from "./status";
import PaneMenu from "./PaneMenu";
import type { Chip } from "../board/chip";
import type { AgentState } from "../projects/rows";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { attachRenderer, type RendererMode } from "./renderer";
import { decodeOutput, endedLabel, forPane, type ExitEvent, type OutputEvent } from "./codec";
import { DIVIDER_DONE, dragging } from "./dividers";
import { currentDark, currentTerminal, monoFont, TERMINAL_EVENT } from "../theme";
import { hookColourMode } from "./colourMode";
import { folderName } from "../projects/model";
import { withoutRules } from "../launch/seats";
import { modelOf } from "../settings/routing";
import { openSettings } from "../settings/pages";
import { Close, Dots, Expand, Plus, SplitRight, StatusGlyph } from "../chrome/icons";
import VendorMark, { type Agent } from "../chrome/VendorMark";
import Ring from "../usage/Ring";
import { meterText, shortTokens, tone as toneOf, type Meter } from "../usage/meter";
import PlusMenu, { programWord, shellWord, type AgentInfo } from "../launch/PlusMenu";
import { useKeymap } from "../keys/KeymapContext";
import { labelOf, matchEvent } from "../keys/keymap";
import { attachPaste } from "./paste";
import { stopLine, type StopInfo } from "./notify";
import NameField from "./NameField";
import { handlesIn } from "./tabs";
import { Kbd, useLabel } from "../keys/KeymapContext";

// TERM-036: the pane menu's copy items; Copy Session ID shows only once the session is known.
const COPY_IDS = [["session", "Copy Session ID"], ["terminal", "Copy Terminal ID"], ["pane", "Copy Pane ID"]] as const;

type Status = { kind: "starting" } | { kind: "running"; id: number; account: string | null } | { kind: "ended"; code: number | null } | { kind: "failed"; error: string };

/** ACCT-064: a centred question over the terminal; Enter takes the first button, Escape the second. */
export type PaneNotice = { title: string; body: string; primary: string; onPrimary: () => void; secondary?: string; onSecondary?: () => void };

type Props = {
  /** Kept mounted but not shown: another workspace is in front (PROJ-066). */
  hidden?: boolean;
  /** VIEW-024: the saved agent's name, shown in the header in place of the program word. */
  name?: string;
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
  /** STAT-001: the pane's last hook-fed state; wins over the title guess while the program runs. */
  hook?: AgentState;
  /** STAT-026: the sub-agents and teammates under this session, shown beside the status word. */
  crew?: Crew;
  /** STAT-022: why the agent halted while `hook` is blocked; the header's tooltip says it. */
  stop?: StopInfo;
  /** STAT-040: how full the agent's context is, 0 to 100, from its last status-line report. */
  context?: number;
  /** USAGE-004: the agent's plan figures beside the gauge on the Agents screen. */
  plan?: string;
  /** TERM-118: the program rang the terminal bell. */
  onBell?: () => void;
  /** TERM-118: finished or rang while not in view; the pane carries the mark until viewed. */
  unread?: boolean;
  /** TERM-045: the session id once it runs, so the window can ask whether closing would stop a program;
   *  ACCT-023: with the Codex account it runs on (null: Codex's own sign-in). */
  onPty?: (id: number, account: string | null) => void;
  /** ACCT-023: the Codex account to resume on; a pane that must not quietly move to another one. */
  account?: string | null;
  /** ACCT-064: a question shown over the terminal (the Codex account changed); null for none. */
  notice?: PaneNotice | null;
  /** The session failed to start (SESS-024: the window drops the pane rather than leaving it blank). */
  onFailed?: (error: string) => void;
  /** A job title from the seat (SESS-024) wins over the workspace name. */
  title?: string;
  /** SESS-006: the shell picked in the create menu names itself in the header. */
  shellName?: string;
  /** TERM-027: the title is one the user (or a seat) set, so Clear Pane Title is offered. */
  custom?: boolean;
  /** TERM-027: saves a typed name; undefined gives the automatic title back. */
  onRename?: (name: string | undefined) => void;
  /** TERM-027: bumped by the Set Title shortcut to open the name field. */
  renameAsk?: number;
  /** TERM-036: the agent's session id is known, so Copy Session ID is offered. */
  sessionKnown?: boolean;
  /** TERM-036: copies one of the pane's ids; the window says whether it worked. */
  onCopyId?: (what: "session" | "terminal" | "pane") => void;
  /** TERM-096: the opener for a printed handle of an open terminal; undefined for anything else. */
  findHandle?: (handle: string) => (() => void) | undefined;
  /** An opening prompt typed in once the agent is ready (SESS-051 typed route). */
  typed?: string;
  /** Names a pane outside any workspace: "Terminal N". */
  number?: number;
  onFocus?: () => void;
  /** Close was asked for; the window decides (TERM-045) and drops the pane, which ends its program. */
  onClose?: () => void;
  /** SAFE-002: set while the agent waits on its plan; the header then offers Review plan. */
  onReviewPlan?: () => void;
  /** The plus menu behind the header's "+" button. */
  agents?: AgentInfo[];
  launching?: boolean;
  onLaunch?: (agent: AgentInfo) => void;
  defaultId?: string;
  onSetDefault?: (id: string) => void;
  onChoose?: () => void;
  /** TERM-006: the header split button opens a shell beside this pane, in the same folder. */
  onSplit?: (dir: "right" | "down") => void;
  /** TERM-013: the grid's expand: `on` while this pane's cell fills the grid; `can` is false for a lone classic pane. */
  expand?: { on: boolean; can: boolean; toggle: () => void };
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
    /** USAGE-002: the compact session meter; null when there is nothing to measure. */
    meter?: Meter | null;
  };
};

export default function TerminalPane({ hidden = false, name, plan, cwd = null, branch = null, focused = false, agent = "shell", program = null, args = [], env, onRunning, onNeedsYou, hook, crew, stop, context, onBell, unread = false, onPty, onFailed, title: jobTitle, typed, shellName, custom = false, onRename, renameAsk = 0, sessionKnown = false, onCopyId, findHandle, number, onFocus, onClose, onReviewPlan, agents = [], launching = false, onLaunch, defaultId, onSetDefault, onChoose, onSplit, expand, card, account, notice = null }: Props) {
  const host = useRef<HTMLDivElement>(null);
  // TERM-096: the link provider is set up once, so it reads the newest opener through a ref.
  const handleRef = useRef(findHandle);
  handleRef.current = findHandle;
  const termRef = useRef<Terminal | null>(null);
  const box = useRef<HTMLElement>(null);
  // TERM-012: the pane Kolux focuses (a shortcut, a new session) takes the keyboard too, unless
  // the keyboard is already somewhere inside it (a click on its own header field).
  useEffect(() => {
    if (focused && !hidden && !box.current?.contains(document.activeElement)) termRef.current?.focus();
  }, [focused, hidden]);
  const [status, setStatus] = useState<Status>({ kind: "starting" });
  const [started, setStarted] = useState<string | null>(null); // ACCT-046: the shell that really started
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [glow, setGlow] = useState(false); // TERM-023: finished while not focused
  const [now, setNow] = useState(() => Date.now());
  const [renderer, setRenderer] = useState<RendererMode | null>(null);
  const [plusAt, setPlusAt] = useState<{ top: number; right: number } | null>(null);
  // TERM-025 / TERM-027: the pane menu, opened by "..." or a right-click on the header, and the inline name field.
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);
  const [naming, setNaming] = useState(false);
  // The menu shows a shortcut only once one is assigned (both start with none).
  const setKey = useLabel("terminal.setTitle").length > 0;
  const clearKey = useLabel("terminal.clearPaneTitle").length > 0;
  useEffect(() => {
    if (renameAsk > 0 && onRename) setNaming(true);
  }, [renameAsk]); // eslint-disable-line react-hooks/exhaustive-deps
  // TERM-022: the branch (or detached commit) of the pane's folder, read when it shows and on focus.
  const [git, setGit] = useState<{ branch: string | null; head: string | null } | null | undefined>(undefined);
  useEffect(() => {
    if (!cwd || hidden) return;
    let live = true;
    invoke<{ branch: string | null; head: string | null } | null>("scm_head", { dir: cwd }).then(
      (h) => live && setGit(h),
      () => live && setGit(null),
    );
    return () => {
      live = false;
    };
  }, [cwd, hidden, focused]);
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
  // SESS-030: a program that starts (a resumed session among them) takes the keyboard only in the focused pane.
  const isFocused = useRef(focused);
  isFocused.current = focused;
  failed.current = onFailed;

  useEffect(() => {
    report.current?.(status.kind === "running");
    if (status.kind === "running") pty.current?.(status.id, status.account);
  }, [status.kind]);
  // ACCT-064: the question takes the keyboard only in the active, visible pane.
  const noticeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (notice && focused && !hidden) noticeButton.current?.focus();
  }, [notice !== null, focused, hidden]);
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
      // TERM-013: ConPTY repaints the screen itself after a resize, so a taller pane gets blank rows
      // rather than history pulled down for ConPTY to paint over (expand then restore kept scrollback).
      ...(navigator.userAgent.includes("Windows") ? { windowsPty: { backend: "conpty" as const } } : {}),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    // TERM-096: a printed handle of an open terminal (term-N) is a link that opens its pane.
    term.registerLinkProvider({
      provideLinks(y, done) {
        const text = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
        const links = handlesIn(text).flatMap(({ start, end, handle }) => {
          const go = handleRef.current?.(handle);
          return go ? [{ range: { start: { x: start + 1, y }, end: { x: end, y } }, text: handle, activate: go }] : [];
        });
        done(links.length > 0 ? links : undefined);
      },
    });
    const choice = attachRenderer<WebglAddon>(term, () => new WebglAddon());
    setRenderer(choice.mode);
    choice.onFallback(() => setRenderer("dom"));
    fit.fit();

    let alive = true;
    let ended = false;
    // Output can arrive before terminal_spawn hands back this pane's id (several panes starting at
    // once); it is held and replayed, else the console's opening cursor query goes unanswered and
    // the program never starts.
    let early: { id: number; run: () => void }[] | null = [];
    const mine = (id: number, run: () => void) => {
      if (idRef.current === null) early?.push({ id, run });
      else if (id === idRef.current) run();
    };
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
        // TERM-098: a chunk tagged with this pane's key is drawn at once, before terminal_spawn answers;
        // anything else that arrives first is held until the id is known and replayed then.
        await listen<OutputEvent>("terminal-output", (e) => {
          const draw = () => {
            term.write(decodeOutput(e.payload.data));
            sawOutput();
          };
          if (idRef.current === null && forPane(e.payload, null, number)) draw();
          else mine(e.payload.id, draw);
        }),
        // CLI-024: the app asks for the frame as it looks now; the rows on screen go back by id.
        await listen<{ id: number; request: string }>("terminal-screen-request", (e) => {
          if (e.payload.id !== idRef.current) return;
          const buf = term.buffer.active;
          const rows: string[] = [];
          for (let y = 0; y < term.rows; y++) rows.push(buf.getLine(buf.viewportY + y)?.translateToString(true) ?? "");
          invoke("terminal_screen_reply", { request: e.payload.request, rows }).catch(() => {});
        }),
        await listen<ExitEvent>("terminal-exit", (e) =>
          mine(e.payload.id, () => {
            ended = true;
            // VIEW-069 / SESS-051: a program that ends before its typed-in opening prompt could be
            // handed over is a launch that failed, not a session that ran.
            if (pending !== null) {
              pending = null;
              failed.current?.("the program ended before its opening prompt could be typed in");
            }
          term.write(`\r\n\x1b[90m[process ${endedLabel(e.payload.code)}]\x1b[0m\r\n`);
            setStatus({ kind: "ended", code: e.payload.code });
          }),
        ),
      );
      if (!alive) {
        // Unmounted while the listeners were registering (StrictMode's double mount): let them go,
        // or a disposed terminal keeps answering screen requests for this pane.
        unlisteners.forEach((u) => u());
        return;
      }
      try {
        const { id, program: ran, account: used } = await invoke<{ id: number; program: string | null; account: string | null }>("terminal_spawn", { cols: term.cols, rows: term.rows, cwd, program, args, env: env ?? null, paneKey: number, account: account ?? null });
        setStarted(ran);
        if (!alive) {
          invoke("terminal_kill", { id }).catch(() => {});
          return;
        }
        idRef.current = id;
        setStatus({ kind: "running", id, account: used });
        const held = early ?? [];
        early = null;
        for (const h of held) if (h.id === id) h.run();
        if (isFocused.current) term.focus();
      } catch (err) {
        early = null;
        setStatus({ kind: "failed", error: String(err) });
        failed.current?.(String(err));
      }
    })();

    const resize = () => {
      // A hidden pane has no size; fitting it would shrink the program's terminal to nothing.
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      fit.fit();
      // TERM-010 (and the size rule of the full-screen card): while a divider is dragged the pane
      // redraws at each size but the program hears only the final one, when the drag ends.
      if (dragging()) return;
      const id = idRef.current;
      if (id !== null && !ended) invoke("terminal_resize", { id, cols: term.cols, rows: term.rows }).catch(() => {});
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    window.addEventListener(DIVIDER_DONE, resize);
    // SET-003: open terminals follow a theme change without being reopened.
    const mode = hookColourMode(term, write, currentDark);
    const recolour = () => {
      term.options.theme = currentTerminal();
      mode.changed();
    };
    window.addEventListener(TERMINAL_EVENT, recolour);

    return () => {
      alive = false;
      window.removeEventListener(DIVIDER_DONE, resize);
      window.removeEventListener(TERMINAL_EVENT, recolour);
      mode.dispose();
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

  // Close asks the window (TERM-045 may confirm first); dropping the pane ends its program
  // through the cleanup above (TERM-014).
  const close = () => onClose?.();

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
  const agentLabel = name ?? (agent === "shell" ? "Plain shell" : programWord(agent));
  // SET-028: a pane started with a model (a seat's pick or a worker's tier) names it.
  const model = agent === "shell" ? null : modelOf(args);
  // TERM-022: before git answers, the branch the pane was opened on; a folder outside git has none.
  const chip = git === undefined ? (branch ? { text: branch, tip: branch } : null) : branchChip(git);
  // TERM-013 / TERM-025: on the Board, expand opens the card; in the grid it fills the grid.
  const onExpand = card ? card.onToggle : expand?.toggle;
  const expanded = card ? card.expanded : !!expand?.on;
  const canExpand = card ? true : !!expand?.can;
  const expandKey = labelOf(keymap, "terminal.expandPane").join("+") || "no shortcut";
  const openMenu = (x: number, y: number) => setMenuAt({ top: Math.min(y, window.innerHeight - 160), left: Math.min(x, window.innerWidth - 240) });

  return (
    <section ref={box} className={`pane${focused ? " focused" : ""}${glow || unread ? " glow" : ""}${unread ? " unread" : ""}${card ? " card" : ""}${card?.expanded ? " expanded" : ""}`} hidden={hidden} aria-label={`${title} pane`} onMouseDown={onFocus} data-agent={agent} style={card?.column ? { gridColumn: card.column } : undefined}>
      <header
        className="pane-head"
        onContextMenu={(e) => {
          if ((e.target as Element).closest?.(".address")) return;
          e.preventDefault();
          openMenu(e.clientX, e.clientY);
        }}
      >
        <span className={`st ${tone || "idle"}`} role="img" aria-label={`status: ${word}`} data-tip={[explain, drawing].filter(Boolean).join(" · ")}>
          <StatusGlyph glyph={glyph} size={glyph === "spinner" ? 11 : 12} />
        </span>
        <span className="agent-mark" title={agentLabel}>
          <VendorMark agent={agent} size={13} />
        </span>
        {naming && onRename ? (
          <NameField
            value={title}
            label="Pane title"
            onSave={(name) => {
              setNaming(false);
              onRename(name);
              termRef.current?.focus();
            }}
            onCancel={() => {
              setNaming(false);
              termRef.current?.focus();
            }}
          />
        ) : (
          <span className="title" title={cwd ?? undefined}>
            {title}
          </span>
        )}
        {chip && (
          <span className="chip" title={chip.tip}>
            {chip.text}
          </span>
        )}
        {/* SESS-025: the start line shown back leaves out the rules block of a side-by-side launch. */}
        <span className="word" title={program ? [program, ...args.map(withoutRules)].join(" ") : undefined}>
          {name ?? shellName ?? (agent === "shell" && !program && started ? shellWord(started) : programWord(agent))}
          {model && ` · ${model}`}
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
          {plan && (
            <span className="meter-plan" title="This agent's plan: its 5-hour and weekly windows">
              {plan}
            </span>
          )}
          {onReviewPlan && (
            <button className="btn plan-review-btn" onClick={onReviewPlan} title="Read the plan, comment on it, then approve or ask for changes">
              Review plan
            </button>
          )}
          <span className={`gauge ${toneOf(context ?? 0)}`.trim()} title={context === undefined ? "Context used (agents only)" : `Context used: ${Math.round(context)}%`}>
            <Ring percent={context ?? 0} />
            {Math.round(context ?? 0)}%
          </span>
          <button
            className="ib"
            title="Pane menu"
            aria-haspopup="menu"
            aria-expanded={menuAt !== null}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              openMenu(r.left, r.bottom + 4);
            }}
          >
            <Dots size={12} />
          </button>
          <button
            className="ib"
            onClick={onExpand}
            disabled={!canExpand}
            aria-expanded={card ? card.expanded : undefined}
            aria-pressed={card ? undefined : expanded}
            title={card ? (card.expanded ? "Collapse: the terminal goes back to its grid slot" : "Expand: show this session's live terminal in the card") : !canExpand ? "Expand: the only pane already fills the grid" : expanded ? `Restore: the other panes come back (${expandKey})` : `Expand: this pane fills the grid (${expandKey})`}
          >
            <Expand size={12} />
          </button>
          {onSplit && (
            <button className="ib" onClick={() => onSplit("right")} title="Split right: a shell in the same folder (Ctrl+Shift+D; Alt+Shift+D splits down)">
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
      {menuAt && (
        <PaneMenu style={menuAt} expanded={expanded} canExpand={canExpand} onExpand={onExpand} onSplit={onSplit} onClose={close} onDismiss={() => setMenuAt(null)}>
          {onRename && (
            <button
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setMenuAt(null);
                setNaming(true);
              }}
            >
              <span className="name">Set Title…</span>
              {setKey && <Kbd id="terminal.setTitle" />}
            </button>
          )}
          {onRename && custom && (
            <button
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setMenuAt(null);
                onRename(undefined);
              }}
            >
              <span className="name">Clear Pane Title</span>
              {clearKey && <Kbd id="terminal.clearPaneTitle" />}
            </button>
          )}
          {onCopyId &&
            COPY_IDS.filter(([what]) => sessionKnown || what !== "session").map(([what, label]) => (
              <button
                key={what}
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setMenuAt(null);
                  onCopyId(what);
                }}
              >
                <span className="name">{label}</span>
              </button>
            ))}
        </PaneMenu>
      )}
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
          onTerminal={
            onSplit &&
            (() => {
              setPlusAt(null);
              onSplit("right");
            })
          }
          onManage={() => {
            setPlusAt(null);
            openSettings("agents");
          }}
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
      {card?.meter && (
        <div className="meter" title={meterText(card.meter)}>
          {card.meter.context && (
            <>
              <span className="meter-bar">
                <span className={`meter-fill ${toneOf(card.meter.context.percent)}`.trim()} style={{ width: `${card.meter.context.percent}%` }} />
              </span>
              <span className="meter-ctx">
                {shortTokens(card.meter.context.tokens)} / {shortTokens(card.meter.context.window)}
              </span>
            </>
          )}
          {card.meter.plan && <span className="meter-plan">{meterText({ plan: card.meter.plan })}</span>}
        </div>
      )}
      <div ref={host} className="pane-body" />
      {notice && (
        <div className="pane-ask" onMouseDown={(e) => e.stopPropagation()}>
          <div
            className="ask"
            role="alertdialog"
            aria-modal="true"
            aria-label={notice.title}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") notice.onSecondary?.();
            }}
          >
            <h2 className="ask-title">{notice.title}</h2>
            <p className="ask-body">{notice.body}</p>
            <div className="btn-row">
              {notice.secondary && (
                <button className="btn" onClick={notice.onSecondary}>
                  {notice.secondary}
                </button>
              )}
              <button ref={noticeButton} className="btn primary" onClick={notice.onPrimary}>
                {notice.primary}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
