// One terminal pane: a shell on the Rust side, drawn by xterm.js here. Typing goes to the PTY,
// output comes back as events, the pane follows the window size, and Close ends the program.
// The card and its header follow design/DESIGN.md section 7: status icon, agent mark, title,
// branch chip, program, status word; then gauge, more, expand, split, close on the right.
import { useEffect, useRef, useState } from "react";
import { branchChip, crewLabel, crewLine, foundAgent, headerOf, titleState, type Crew } from "./status";
import PaneMenu from "./PaneMenu";
import type { Chip } from "../board/chip";
import type { AgentState } from "../projects/rows";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { attachRenderer, watchResume, type RendererMode } from "./renderer";
import { copySelection } from "./copy";
import { HeldKeys, screenLines, shouldRefocus, watchScale } from "./recover";
import { decodeOutput, endedLabel, forPane, type ExitEvent, type OutputEvent } from "./codec";
import { encodeHistory, replay, restoreTail, viewTop } from "./history";
import { batchAcks, memoryProfile } from "./flow";
import { explain as explainError, exitAdvice } from "./errors";
import { DIVIDER_DONE, dragging } from "./dividers";
import { currentDark, currentTerminal, TERMINAL_EVENT, termFont } from "../theme";
import { currentText, optionsOf, TEXT_EVENT } from "./text";
import { hookColourMode } from "./colourMode";
import { folderName } from "../projects/model";
import { withoutRules } from "../launch/seats";
import { modelOf } from "../settings/routing";
import { openSettings } from "../settings/pages";
import { answerKeys, buttonsShown, canAnswer, nextPrompt } from "./permissionAnswer";
import { Close, Dots, Expand, Plus, SplitRight, StatusGlyph } from "../chrome/icons";
import VendorMark, { type Agent } from "../chrome/VendorMark";
import Ring from "../usage/Ring";
import { meterText, shortTokens, tone as toneOf, type Meter } from "../usage/meter";
import PlusMenu, { programWord, shellWord, type AgentInfo } from "../launch/PlusMenu";
import { useKeymap } from "../keys/KeymapContext";
import { labelOf } from "../keys/keymap";
import { attachPaste } from "./paste";
import { answersPrompt, newlineAgent, routeKey } from "./shellKeys";
import { heldByTerminal } from "../keys/terminalPolicy";
import { clickTarget, findLinks, hintFor, linkFor, rangeOf, resolvePath, spanOf, type Found } from "./links";
import { dropSummary, dropText, overRect, shellKind } from "./drop";
import { decideOsc52, parseOsc52, sayOnce } from "./osc52";
import { findIn, linesOf, nearestFrom, placeMatches, searchLater, segments, stepIndex, type BufRow, type FindOptions, type Match, type Runner } from "./find";
import FindBar from "./FindBar";
import { stopLine, type StopInfo } from "./notify";
import NameField from "./NameField";
import { handlesIn } from "./tabs";
import { Kbd, useLabel } from "../keys/KeymapContext";

// TERM-036: the pane menu's copy items; Copy Session ID shows only once the session is known.
const COPY_IDS = [["session", "Copy Session ID"], ["terminal", "Copy Terminal ID"], ["pane", "Copy Pane ID"]] as const;

type Status = { kind: "starting" } | { kind: "running"; id: number; account: string | null } | { kind: "ended"; code: number | null } | { kind: "failed"; error: string };

/** council D2 MERGE 31 (3): the host element of a dev build carries its terminal for the evidence probes. */
type DevHost = HTMLDivElement & { __koluxTerm?: Terminal; __koluxLinks?: (y: number) => unknown[] };

/** APP-009 / T-248-a: the menu's Edit > Copy and Select All reach the focused terminal through this.
 * They are calls, never key presses: an empty selection copies nothing, and a rebound chord can't break it. */
export const focusedTerminalEdit: { current: ((op: "copy" | "selectAll") => void) | null } = { current: null };

/** ACCT-064: a centred question over the terminal; Enter takes the first button, Escape the second. */
export type PaneNotice = { title: string; body: string; primary: string; onPrimary: () => void; secondary?: string; onSecondary?: () => void };

type Props = {
  /** Kept mounted but not shown: another workspace is in front (PROJ-066). */
  hidden?: boolean;
  /** TERM-103: false draws plain; true tries the GPU path (six panes at most, the rest plain). */
  gpu?: boolean;
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
  hook?: AgentState | "background";
  /** The tool a hook PermissionRequest is waiting on (the hook status's `tool` while `hook` is "permission"): the
   *  Approve/Deny buttons show, and type, only while one is named, never on a title or OSC guess. */
  pendingTool?: string;
  /** Council D2 MERGE 47 FB1: the settings the key policy reads ("Terminal first" holds chords for the program). */
  keySettings?: Record<string, unknown> | null;
  /** STAT-026: the sub-agents and teammates under this session, shown beside the status word. */
  crew?: Crew;
  /** STAT-022: why the agent halted while `hook` is blocked; the header's tooltip says it. */
  stop?: StopInfo;
  /** STAT-040: how full the agent's context is, 0 to 100, from its last status-line report;
   * null or left out while no reading has come in yet (USAGE-001: a greyed 0%). */
  context?: number | null;
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
  /** TERM-106: the pane came back from the saved layout; what it printed before is shown first. */
  restored?: boolean;
  /** TERM-075: the setting "Programs can copy to the clipboard" (OSC 52); on unless turned off. */
  clipboardFromPrograms?: boolean;
  /** TERM-107 (T-066-c): false when the restored agent's start line carries no resume form. */
  resumed?: boolean;
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
  /** TERM-092: Ctrl+click on a web link opens it in Kolux's own viewer through `onOpenLink` when this is on (off by
   *  default); Shift held, or no viewer, always means the system browser. */
  linksOpenInKolux?: boolean;
  onOpenLink?: (url: string) => void;
  /** TERM-093: Ctrl+click on a printed file path (resolved against the pane's folder) hands it here, with the line
   *  from a path:line suffix; absent, the system opens the file. */
  onOpenFile?: (path: string, line?: number) => void;
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

// TERM-113: panes that are not on screen at mount (background tabs of a restored layout) start one
// after another, a short beat apart, so the shown tab's programs get the first spawns and come up
// usable first. ponytail: a timer ladder, not a queue; the visible panes never wait.
let waiting = 0;
const stagger = () =>
  new Promise<void>((done) =>
    setTimeout(() => {
      waiting--;
      done();
    }, 150 + 60 * waiting++),
  );

export default function TerminalPane({ hidden = false, gpu = true, name, plan, cwd = null, branch = null, focused = false, agent = "shell", program = null, args = [], env, onRunning, onNeedsYou, hook, pendingTool, keySettings = null, crew, stop, context, onBell, unread = false, onPty, onFailed, title: jobTitle, typed, shellName, custom = false, onRename, renameAsk = 0, sessionKnown = false, onCopyId, findHandle, number, onFocus, onClose, onReviewPlan, agents = [], launching = false, onLaunch, defaultId, onSetDefault, onChoose, onSplit, expand, card, account, notice = null, restored = false, clipboardFromPrograms = true, linksOpenInKolux = false, onOpenLink, onOpenFile, resumed }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const keySettingsRef = useRef(keySettings);
  keySettingsRef.current = keySettings;
  const clipboardOk = useRef(clipboardFromPrograms);
  clipboardOk.current = clipboardFromPrograms;
  // TERM-096: the link provider is set up once, so it reads the newest opener through a ref.
  const handleRef = useRef(findHandle);
  handleRef.current = findHandle;
  // TERM-092/093: the link provider and the key handler are set up once too; the newest openers, folder and agent
  // are read through refs.
  const openRef = useRef({ linksOpenInKolux, onOpenLink, onOpenFile, cwd });
  openRef.current = { linksOpenInKolux, onOpenLink, onOpenFile, cwd };
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const [linkHint, setLinkHint] = useState<string | null>(null);
  const termRef = useRef<Terminal | null>(null);
  // STAT-033: the state the program's own terminal title last stood for; only read while no hook reports.
  const [guess, setGuess] = useState<AgentState | null>(null);
  const box = useRef<HTMLElement>(null);
  // TERM-012: the pane Kolux focuses (a shortcut, a new session) takes the keyboard too, unless
  // the keyboard is already somewhere inside it (a click on its own header field).
  useEffect(() => {
    if (focused && !hidden && !box.current?.contains(document.activeElement)) termRef.current?.focus();
  }, [focused, hidden]);
  const [status, setStatus] = useState<Status>({ kind: "starting" });
  const [started, setStarted] = useState<string | null>(null); // ACCT-046: the shell that really started
  const startedRef = useRef(started);
  startedRef.current = started;
  // TERM-074: a file drag is over this pane (the box shows a focus outline until it drops or leaves).
  const [dropping, setDropping] = useState(false);
  // TERM-077: the find bar; the matches, their marks and the current one live in refs (the terminal draws them).
  const [finding, setFinding] = useState(false);
  const [hits, setHits] = useState<{ count: number; current: number; slow?: boolean }>({ count: 0, current: -1 });
  const cancelFind = useRef<() => void>(() => {});
  useEffect(() => () => cancelFind.current(), []);
  const matches = useRef<Match[]>([]);
  const marks = useRef<{ dispose(): void }[]>([]);
  const lastFind = useRef<{ query: string; opts: FindOptions }>({ query: "", opts: { caseSensitive: false, regex: false } });
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [glow, setGlow] = useState(false); // TERM-023: finished while not focused
  const [now, setNow] = useState(() => Date.now());
  const [renderer, setRenderer] = useState<RendererMode | null>(null);
  // TERM-065: a short line in the header when the clipboard refused a copy; the selection stays.
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!focused) return;
    const fn = (op: "copy" | "selectAll") => {
      const term = termRef.current;
      if (!term) return;
      if (op === "selectAll") term.selectAll();
      else void copySelection(term, (text) => navigator.clipboard.writeText(text), setFlash);
    };
    focusedTerminalEdit.current = fn;
    return () => {
      if (focusedTerminalEdit.current === fn) focusedTerminalEdit.current = null;
    };
  }, [focused]);
  // TERM-031: the prompt count (bumped below, once the hook state is known) and, T-151-b, the count of the
  // prompt the user already answered (click or keystroke): the Approve/Deny buttons hide for it and come
  // back when the next prompt bumps the count.
  const prompt = useRef<{ count: number; hook: AgentState | "background" | undefined }>({ count: 0, hook: undefined });
  const [answered, setAnswered] = useState(0);
  // T-151-b (TERM-069): "Paste N lines?" waiting for Paste or Cancel.
  const [pasteAsk, setPasteAsk] = useState<{ lines: number; go: () => void } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(t);
  }, [flash]);
  // TERM-107: a restored pane wears a mark in its header until the first key or click in it; an agent
  // pane whose start line does not resume its conversation is marked as restored without resume.
  const [restoredMark, setRestoredMark] = useState<string | null>(null);
  // TERM-111: a shell that died (non-zero exit) stays with an overlay offering a restart in the same
  // pane; restart() re-runs the start line, or opens a plain shell, keeping the buffer.
  const [died, setDied] = useState<number | null>(null);
  const restart = useRef<(shell: boolean) => void>(() => {});
  /** TERM-031: types into the program through the pane's ordered write chain (set once the terminal is up).
   *  TERM-074: with `only`, the text goes in only while that program is still the pane's (nothing after a restart). */
  const typeIn = useRef<(data: string, only?: number) => void>(() => {});
  /** TERM-076 / TERM-077: the pane's own actions behind a Kolux chord, reached from the key handler through refs. */
  const clearRef = useRef<() => void>(() => {});
  const findRef = useRef<() => void>(() => {});
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [plusAt, setPlusAt] = useState<{ top: number; right: number } | null>(null);
  // ACCT-050: the agent the user started by hand in this shell, as Rust recognises it.
  const [found, setFound] = useState<Agent | null>(null);
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
  const isHidden = useRef(hidden);
  isHidden.current = hidden;
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
      ...optionsOf(currentText()),
      ...termFont(number), // TERM-097 / TERM-078: saved font plus this pane's zoom (wins over the SET-022 text font fields)
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
    // STAT-033: the title the program sets stands in for its state while no hook reports.
    term.onTitleChange((t) => setGuess((g) => titleState(t) ?? g));
    // STAT-034: a status printed in band (OSC 9999) goes to Rust; xterm never draws the sequence.
    term.parser.registerOscHandler(9999, (data) => (invoke("status_inband", { paneKey: number, data }).catch(() => {}), true));
    // council D2 MERGE 31 (3): in a dev build the pane's terminal is reachable from its host element, so the
    // evidence probes can read the scrollback cap and the buffer length (the way launchWarn.ts exposes
    // __koluxUsage). A release build has no handle.
    if (import.meta.env.DEV) (el as DevHost).__koluxTerm = term;
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
    // TERM-092 / TERM-093: web links and file paths are links (Ctrl+click; Cmd+click on macOS); a link wrapped over
    // rows is read as one; the hint under the pointer says where the click goes. The text work is in links.ts.
    const openFound = (f: Found, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }) => {
      const o = openRef.current;
      const door = clickTarget(f, e, keys.current.platform === "darwin", o.linksOpenInKolux && !!o.onOpenLink);
      if (door === null) return;
      const said = (err: unknown) => setFlash(explainError(String(err)));
      if (door === "kolux") o.onOpenLink?.(f.target);
      else if (door === "system") invoke("open_external", { url: f.target }).catch(said);
      else {
        const path = resolvePath(f.target, o.cwd);
        if (!path) setFlash(`${f.target} is a relative path and this pane has no folder`);
        else if (o.onOpenFile) o.onOpenFile(path, f.line);
        else invoke("open_path", { path }).catch(said);
      }
    };
    const hintOf = (f: Found) => {
      const o = openRef.current;
      const where = f.kind === "file" ? (o.onOpenFile ? "editor" : "app") : o.linksOpenInKolux && o.onOpenLink ? "kolux" : "browser";
      return hintFor(f, keys.current.platform === "darwin", where);
    };
    // the hint and the underline clear when the window loses focus (the pointer may never "leave" the link)
    const blurLinks = () => {
      setLinkHint(null);
      term.element?.querySelector(".xterm-screen")?.dispatchEvent(new MouseEvent("mouseleave"));
    };
    window.addEventListener("blur", blurLinks);
    const linksOn = (y: number) => {
      const cols = term.cols;
      const row = (i: number) => {
        const l = term.buffer.active.getLine(i);
        return l ? { text: l.translateToString(false), isWrapped: l.isWrapped } : undefined;
      };
      const span = spanOf(row, y - 1, cols);
      return findLinks(span.text).map((f) => ({
        range: rangeOf(f.start, f.end, span.first, cols),
        text: f.target,
        activate: (e: MouseEvent) => openFound(f, e),
        hover: () => setLinkHint(hintOf(f)),
        leave: () => setLinkHint(null),
      }));
    };
    term.registerLinkProvider({
      provideLinks(y, done) {
        const links = linksOn(y);
        done(links.length > 0 ? links : undefined);
      },
    });
    if (import.meta.env.DEV) (el as DevHost).__koluxLinks = linksOn;
    // a program's own OSC 8 link (file:// allowed, other schemes are not links)
    term.options.linkHandler = {
      allowNonHttpProtocols: true,
      activate: (e, uri) => {
        const f = linkFor(uri);
        if (f) openFound(f, e);
      },
      hover: (_e, uri) => {
        const f = linkFor(uri);
        if (f) setLinkHint(hintOf(f));
      },
      leave: () => setLinkHint(null),
    };
    const choice = attachRenderer<WebglAddon>(term, () => new WebglAddon(), gpu);
    setRenderer(choice.mode);
    choice.onFallback(() => setRenderer("dom"));
    fit.fit();

    let alive = true;
    // ACCT-059: scrollback sized to the machine's memory profile, the same every start.
    memoryProfile().then((p) => {
      if (alive) term.options.scrollback = p.scrollback;
    });
    // ACCT-054: output is acknowledged as drawn, in running totals, so the reader pauses the
    // program when this pane falls behind rather than letting the app fall behind with it.
    const acks = batchAcks((bytes) => {
      const id = idRef.current;
      if (id !== null) invoke("terminal_ack", { id, bytes }).catch(() => {});
    });
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
    // TERM-098: output drawn before terminal_spawn hands back the id can hold the console's
    // opening cursor query; the terminal's answer goes through write() like a key, so it is held
    // here and sent once the id is known, or the shell never starts.
    // TERM-115: keys typed while the shell is still starting are held and sent once it runs
    // (capped); a write the program side refuses is said out loud rather than lost in silence.
    const held = new HeldKeys();
    // TERM-071: writes go one after another (terminal_write is async, so two in flight could land out
    // of order); a chunked paste then reaches the program in order, and a key typed during it waits its turn.
    let chain: Promise<unknown> = Promise.resolve();
    const write = (data: string, only?: number): Promise<unknown> | void => {
      const id = idRef.current;
      if (only !== undefined && only !== id) return;
      // Council D2 MERGE 31 (2): Ctrl+C or Esc during a paste drops what has not gone yet; the key itself still goes.
      if (data === "\x03" || data === "\x1b") pasting.cancel();
      if (ended) {
        // TERM-111: after an agent's program ended, Enter leaves the pane with a working shell.
        if (data === "\r" && agent !== "shell") restart.current(true);
        return;
      }
      if (id === null) {
        if (!held.push(data)) setFlash("Keys typed before the shell started were dropped past 16 KB");
        return;
      }
      return (chain = chain
        .then(() => {
          // TERM-074: the terminal changed (a restart) while the drop waited its turn: nothing is pasted.
          if (only !== undefined && idRef.current !== only) {
            setFlash("The terminal changed before the drop landed; nothing was typed");
            return;
          }
          return invoke("terminal_write", { id, data });
        })
        .catch((e) => setFlash(`Typing could not reach the program (${explainError(String(e))})`)));
    };
    term.onData((data) => {
      write(data);
    });
    term.onBell(() => bell.current?.());
    // TERM-075: a program's OSC 52 copy goes to the system clipboard (while the setting allows it); a
    // read-back query gets an empty answer so the program never sees the clipboard; each way it can be
    // refused is said once per session in the header.
    term.parser.registerOscHandler(52, (data) => {
      const d = decideOsc52(parseOsc52(data), clipboardOk.current, !isHidden.current);
      if (d.reply) void write(d.reply);
      if (d.notice) sayOnce(d.notice.key, d.notice.text, setFlash);
      if (d.write !== undefined) navigator.clipboard.writeText(d.write).catch((e) => sayOnce("osc52-unconfirmed", `A program's copy to the clipboard could not be confirmed (${e instanceof Error ? e.message : String(e)})`, setFlash));
      return true;
    });
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
    typeIn.current = (data, only) => void write(data, only);
    const pasting = attachPaste(
      term.textarea,
      (text) => {
        // Council D2 MERGE 31 (2): the chunk goes straight to the program through the ordered write chain
        // (xterm's own paste would bracket every chunk and run ahead of the writes); paste.ts has already
        // rewritten the line ends and bracketed the whole paste once, and the next chunk waits for this
        // promise. The scroll-to-bottom mirrors what xterm does on user input.
        if (term.options.scrollOnUserInput !== false) term.scrollToBottom();
        const landed = write(text);
        // TERM-103: a paste burst fills the glyph atlas with one-off runs; start it fresh afterwards.
        if (text.length > 2048) choice.clearGlyphs();
        return landed;
      },
      () => pending !== null,
      setFlash, // TERM-071: a paste over the limit says so in the header; nothing is sent
      () => term.modes.bracketedPasteMode && term.options.ignoreBracketedPasteMode !== true,
      // TERM-069: on Windows a multi-line paste always goes bracketed (single-line keeps the fast path).
      () => navigator.userAgent.includes("Windows"),
      // T-151-b: 2+ lines into a program that has not turned on bracketed paste asks first.
      (lines, go) => setPasteAsk({ lines, go }),
    );
    // TERM-079: Kolux first. shellKeys.ts decides (tested there): a Kolux chord never reaches the
    // program, a shell key always does, the word and line moves are sent as the shell reads them.
    // TERM-065: the copy chord copies a selection and gives the keyboard back; Ctrl+C with nothing
    // selected is the program's interrupt and goes through untouched. Nothing selected under
    // Ctrl+Shift+C does nothing and says nothing.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const route = routeKey(keys.current, e, term.hasSelection(), newlineAgent(startedRef.current, agentRef.current), (id) => heldByTerminal(id, keySettingsRef.current));
      // T-151-b (council D2 MERGE 47 S2): a real key that goes to the program answers the permission prompt as
      // far as the buttons are concerned; xterm's own focus / mouse / cursor replies (onData) no longer do.
      if (answersPrompt(route, e.key)) setAnswered(prompt.current.count);
      if (route.kind === "ime" || route.kind === "shell") return true;
      if (route.kind === "send") {
        e.preventDefault(); // Alt+Left is the webview's own "back" otherwise
        void write(route.data);
        return false;
      }
      if (route.kind === "scroll") {
        e.preventDefault();
        if (route.to === "top") term.scrollToTop();
        else term.scrollToBottom();
        return false;
      }
      const id = route.id;
      // The paste chord is left to the browser: its paste event is what attachPaste reads.
      if (id === "terminal.paste") return false;
      e.preventDefault();
      if (id === "terminal.selectAll") term.selectAll();
      else if (id === "terminal.copySelection") void copySelection(term, (text) => navigator.clipboard.writeText(text), setFlash);
      else if (id === "terminal.clear") clearRef.current();
      else if (id === "terminal.search") findRef.current();
      // Any other Kolux chord (the window's own actions) is the window's; the shell never sees it.
      return false;
    });

    (async () => {
      unlisteners.push(
        // TERM-098: a chunk tagged with this pane's key is drawn at once, before terminal_spawn answers;
        // anything else that arrives first is held until the id is known and replayed then.
        await listen<OutputEvent>("terminal-output", (e) => {
          const draw = () => {
            const bytes = decodeOutput(e.payload.data);
            term.write(bytes, () => acks.drew(bytes.length));
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
        await listen<{ terminal: number; agent: string | null }>("pane-agent", (e) =>
          mine(e.payload.terminal, () => setFound(foundAgent(e.payload.agent))),
        ),
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
            // TERM-111: a shell that exited by itself closes its pane (its neighbours take the space and
            // the tab goes with its last pane); one that died stays, with the exit code and a Restart;
            // an agent pane keeps what its program printed and Enter starts a shell in it.
            const code = e.payload.code;
            if (agent !== "shell") term.write("\x1b[90mEnter starts a shell here\x1b[0m\r\n");
            else if (code === 0 || code === null) closeRef.current?.();
            else setDied(code);
          }),
        ),
      );
      if (!alive) {
        // Unmounted while the listeners were registering (StrictMode's double mount): let them go,
        // or a disposed terminal keeps answering screen requests for this pane.
        unlisteners.forEach((u) => u());
        return;
      }
      // TERM-110: a failure to start is said in plain words (SESS-024 then drops the pane and says so).
      const fail = (err: unknown) => {
        early = null;
        const why = explainError(String(err), cwd ?? "no folder");
        setStatus({ kind: "failed", error: why });
        failed.current?.(why);
      };
      // TERM-111: start() also serves the overlay's Restart (the original start line) and the shell an
      // agent pane gets on Enter after its program ended; the buffer is kept both times.
      const start = async (prog: string | null, argv: readonly string[], keepInView: boolean) => {
        try {
          const { id, program: ran, account: used } = await invoke<{ id: number; program: string | null; account: string | null }>("terminal_spawn", { cols: term.cols, rows: term.rows, cwd, program: prog, args: argv, env: env ?? null, paneKey: number, account: account ?? null });
          setStarted(ran);
          if (!alive) {
            invoke("terminal_kill", { id }).catch(() => {});
            return;
          }
          idRef.current = id;
          if (keepInView) {
            const follow = term.onWriteParsed(() => term.scrollToLine(viewTop(term.buffer.active, term.rows)));
            const stop = term.onKey(() => {
              follow.dispose();
              stop.dispose();
            });
          }
          setStatus({ kind: "running", id, account: used });
          const queued = early ?? [];
          early = null;
          for (const h of queued) if (h.id === id) h.run();
          held.drain(write);
          if (held.dropped > 0) setFlash(`${held.dropped} characters typed before the shell started were dropped`);
          if (isFocused.current) term.focus();
        } catch (err) {
          fail(err);
        }
      };
      restart.current = (shell) => {
        if (!alive) return;
        ended = false;
        idRef.current = null;
        early = [];
        setDied(null);
        setStatus({ kind: "starting" });
        void start(shell ? null : program, shell ? [] : args, false);
      };
      try {
        // TERM-106: a pane back from a restart shows what it printed before, then a fresh shell. The
        // saved file is a transcript of everything this pane's terminal processed, so replaying it
        // draws the same screen; what the pane writes next (reset, note, screen pushed up, cursor at
        // the top) goes into the file too, before the shell starts, so the next restart replays true.
        // The view keeps the old output and the note above the new prompt until the user types: the
        // pty's first frames come after the spawn and move the prompt row, so the view follows each
        // of them (an idle shell writes nothing more) and lets go at the first key. A key, not
        // onData: the terminal's own answers to the shell's start-up questions go through onData.
        let keepInView = false;
        if (restored) {
          setRestoredMark(resumed === false ? "restored without resume" : "restored");
          const unmark = () => {
            setRestoredMark(null);
            key.dispose();
            box.current?.removeEventListener("mousedown", unmark);
          };
          const key = term.onKey(unmark);
          box.current?.addEventListener("mousedown", unmark);
          const saved = await invoke<string>("terminal_history", { paneKey: number }).catch(() => "");
          if (!alive) return;
          const text = replay(saved);
          if (text) {
            await new Promise<void>((done) => term.write(text, done));
            if (!alive) return;
            const tail = restoreTail(term.buffer.normal, term.rows);
            await new Promise<void>((done) => term.write(tail, done));
            if (!alive) return;
            await invoke("terminal_history_append", { paneKey: number, data: encodeHistory(tail) }).catch(() => {});
            if (!alive) return;
            keepInView = true;
          }
        }
        // TERM-113: a pane that is not on screen at mount lets the shown ones start first.
        if (el.clientWidth === 0 || el.clientHeight === 0) await stagger();
        if (!alive) return;
        await start(program, args, keepInView);
      } catch (err) {
        fail(err);
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
      Object.assign(term.options, termFont(number));
      resize();
      mode.changed();
    };
    window.addEventListener(TERMINAL_EVENT, recolour);
    // SET-022 / SET-025: open terminals follow the text, cursor and history settings.
    const retext = () => {
      Object.assign(term.options, optionsOf(currentText()), termFont(number));
      resize();
    };
    window.addEventListener(TEXT_EVENT, retext);
    // SET-025: copy on select, and right-click paste (the menu stays away while it is on).
    const selected = term.onSelectionChange(() => {
      if (currentText().copyOnSelect && term.hasSelection()) void navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
    });
    const rightClick = (e: MouseEvent) => {
      if (!currentText().rightClickPaste) return;
      e.preventDefault();
      if (term.hasSelection()) {
        void navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
        term.clearSelection();
      } else void navigator.clipboard?.readText().then((t) => t && pasting.paste(t), () => {});
    };
    el.addEventListener("contextmenu", rightClick);
    // TERM-103 / TERM-114: after the machine slept the GPU's glyph atlas may be stale and the
    // program's size may be behind; a late heartbeat says so. A display scale change does the same.
    const wake = () => {
      choice.clearGlyphs();
      resize();
    };
    const sleep = watchResume(wake);
    const beat = setInterval(sleep.tick, 5000);
    const scale = watchScale(wake);
    // TERM-114: the window coming back puts typing in the pane that had it, unless the user
    // clicked somewhere else meanwhile.
    const refocus = () => {
      if (!isHidden.current && shouldRefocus(isFocused.current, document.activeElement)) term.focus();
    };
    window.addEventListener("focus", refocus);

    return () => {
      alive = false;
      window.removeEventListener(DIVIDER_DONE, resize);
      window.removeEventListener(TERMINAL_EVENT, recolour);
      window.removeEventListener(TEXT_EVENT, retext);
      el.removeEventListener("contextmenu", rightClick);
      selected.dispose();
      mode.dispose();
      clearInterval(beat);
      scale.dispose();
      window.removeEventListener("focus", refocus);
      termRef.current = null;
      clearTimeout(quiet);
      observer.disconnect();
      unlisteners.forEach((u) => u());
      const id = idRef.current;
      if (id !== null) invoke("terminal_kill", { id }).catch(() => {});
      choice.dispose();
      pasting.detach();
      acks.stop();
      term.dispose();
      delete (el as DevHost).__koluxTerm;
      delete (el as DevHost).__koluxLinks;
      window.removeEventListener("blur", blurLinks);
    };
  }, []);

  // TERM-074: a file dropped on this pane's box is typed into this pane, quoted for its shell, no Enter,
  // whichever pane has the keyboard. The webview's drag events carry physical pixels; the hit test uses
  // the element under the pointer, so a drop on an overlay or a menu over the pane is not a drop on it.
  useEffect(() => {
    if (hidden) return;
    let live = true;
    let stop: UnlistenFn | undefined;
    getCurrentWebview()
      .onDragDropEvent(({ payload: p }) => {
        const el = box.current;
        if (!el || p.type === "leave") {
          setDropping(false);
          return;
        }
        const scale = window.devicePixelRatio || 1;
        const x = p.position.x / scale;
        const y = p.position.y / scale;
        const under = document.elementFromPoint(x, y);
        const over = overRect(x, y, el.getBoundingClientRect()) && under !== null && el.contains(under);
        if (p.type !== "drop") {
          setDropping(over);
          return;
        }
        setDropping(false);
        if (!over) return;
        const term = termRef.current;
        const id = idRef.current;
        if (!term || id === null) {
          setFlash("Nothing is running in this pane to drop into");
          return;
        }
        const { text, typed, refused } = dropText(p.paths, shellKind(startedRef.current));
        const left = refused === 0 ? "" : `${refused === 1 ? "1 path was" : `${refused} paths were`} not typed: its name holds a control character, or $ \` % ! or a curly quote this program could expand`;
        if (!text) {
          if (left) setFlash(left);
          return;
        }
        typeIn.current(text, id);
        setFlash(left ? `${dropSummary(typed)}; ${left}` : dropSummary(typed));
        onFocus?.();
        term.focus();
      })
      .then((un) => {
        if (live) stop = un;
        else un();
      });
    return () => {
      live = false;
      stop?.();
    };
  }, [hidden]); // eslint-disable-line react-hooks/exhaustive-deps

  // TERM-077: the search runs over every row the terminal holds (scrollback included); each match gets a
  // mark drawn under its text, the current one is selected and scrolled into view. The marks go when the
  // bar closes or the screen is cleared.
  const dropMarks = () => {
    marks.current.forEach((m) => m.dispose());
    marks.current = [];
  };
  const showMatch = (term: Terminal, i: number) => {
    const m = matches.current[i];
    if (!m) {
      term.clearSelection();
      return;
    }
    term.select(m.col, m.row, m.len);
    const top = term.buffer.active.viewportY;
    if (m.row < top || m.row >= top + term.rows) term.scrollToLine(Math.max(0, m.row - Math.floor(term.rows / 2)));
  };
  // Every row of the buffer as cells: a row of plain ASCII as its string (one cell per character), any
  // other row cell by cell so wide characters keep their two cells.
  const bufferLines = (term: Terminal) => {
    const buf = term.buffer.active;
    const rows: BufRow[] = [];
    for (let y = 0; y < buf.length; y++) {
      const l = buf.getLine(y);
      if (!l) {
        rows.push({ wrapped: false, cells: "" });
        continue;
      }
      const s = l.translateToString(false);
      if (s.length === term.cols && /^[ -~]*$/.test(s)) rows.push({ wrapped: l.isWrapped, cells: s });
      else {
        const cells = [];
        for (let x = 0; x < term.cols; x++) {
          const c = l.getCell(x);
          cells.push({ chars: c?.getChars() ?? "", width: c?.getWidth() ?? 1 });
        }
        rows.push({ wrapped: l.isWrapped, cells });
      }
    }
    return linesOf(rows, term.cols);
  };
  const spawnFind = (): Runner => {
    const w = new Worker(new URL("./findWorker.ts", import.meta.url), { type: "module" });
    return {
      run: (texts, query, opts, done) => {
        w.onmessage = (e: MessageEvent<Match[]>) => done(e.data);
        w.postMessage({ texts, query, opts });
      },
      stop: () => w.terminate(),
    };
  };
  const drawFind = (term: Terminal, found: Match[]) => {
    dropMarks();
    matches.current = found;
    const buf = term.buffer.active;
    const cursorRow = buf.baseY + buf.cursorY;
    for (const m of found)
      for (const s of segments(m, term.cols)) {
        const marker = term.registerMarker(s.row - cursorRow);
        if (!marker) continue;
        marks.current.push(marker);
        const mark = term.registerDecoration({ marker, x: s.col, width: s.len, backgroundColor: "#b8860b", layer: "bottom" });
        if (mark) marks.current.push(mark);
      }
    const i = nearestFrom(found, buf.viewportY);
    setHits({ count: found.length, current: i });
    showMatch(term, i);
  };
  const runFind = (query: string, opts: FindOptions) => {
    lastFind.current = { query, opts };
    cancelFind.current();
    const term = termRef.current;
    if (!term) return;
    if (!opts.regex || query === "") {
      const lines = bufferLines(term);
      drawFind(term, placeMatches(lines, findIn(lines.map((l) => l.text), query, opts), term.cols));
      return;
    }
    let lines: ReturnType<typeof bufferLines> = [];
    cancelFind.current = searchLater(
      () => (lines = bufferLines(term)).map((l) => l.text),
      query,
      opts,
      (found) => drawFind(term, placeMatches(lines, found, term.cols)),
      () => {
        dropMarks();
        matches.current = [];
        setHits({ count: 0, current: -1, slow: true });
        term.clearSelection();
      },
      spawnFind,
    );
  };
  const stepFind = (dir: 1 | -1) => {
    const term = termRef.current;
    if (!term) return;
    const i = stepIndex(matches.current.length, hits.current, dir);
    setHits({ count: matches.current.length, current: i });
    showMatch(term, i);
  };
  const closeFind = () => {
    cancelFind.current();
    dropMarks();
    matches.current = [];
    setHits({ count: 0, current: -1 });
    setFinding(false);
    termRef.current?.clearSelection();
    termRef.current?.focus();
  };
  findRef.current = () => setFinding(true);
  // TERM-076: Clear Screen drops what is on screen and the scrollback; the marks and link ranges go with
  // the rows (links are read per row on demand). The saved transcript (TERM-106) is left as it is.
  clearRef.current = () => {
    const term = termRef.current;
    if (!term) return;
    dropMarks();
    term.clear();
    if (finding) runFind(lastFind.current.query, lastFind.current.opts);
  };

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
  // TERM-031: one count per prompt shown (each entry into "permission"); an Approve/Deny control
  // carries the count it was drawn with, so an answer to a prompt that has gone sends nothing.
  if (prompt.current.hook !== hook) prompt.current = { count: nextPrompt(prompt.current.count, prompt.current.hook, hook), hook };
  // A shell pane running an agent the user started by hand reads as that agent's session.
  const shown: Agent = agent === "shell" && found ? found : agent;
  const header = headerOf(shown, status.kind, status.kind === "ended" ? status.code : undefined, false, finishedAt, now, hook ?? guess ?? undefined);
  const { word, tone, glyph, age, needsYou } = header;
  const explain = header.state === "blocked" && stop ? `${stopLine(stop)}.` : header.explain;
  const needs = useRef(onNeedsYou);
  needs.current = onNeedsYou;
  useEffect(() => {
    needs.current?.(needsYou);
  }, [needsYou]);
  const drawing = renderer === "webgl" ? "GPU renderer" : renderer === "dom" ? "plain renderer" : "";
  // TERM-116: the last 60 lines on screen plus what Kolux knows, scrubbed on the Rust side, to the
  // clipboard; every way it can fail says so in the header.
  const copyDiagnostics = async () => {
    const term = termRef.current;
    const id = idRef.current;
    if (!term || id === null) {
      setFlash("No session to describe yet");
      return;
    }
    const screen = screenLines(term.buffer.active);
    let text: string;
    try {
      text = await invoke<string>("terminal_diagnostics", { id, cols: term.cols, rows: term.rows, renderer: drawing || "unknown", screen });
    } catch (e) {
      setFlash(`Diagnostics could not be built (${String(e)})`);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setFlash("Diagnostics copied");
    } catch (e) {
      setFlash(`Diagnostics could not be copied (${e instanceof Error ? e.message : String(e)})`);
    }
    term.focus();
  };
  // The seat's job title names the pane; else the workspace folder (an agent launch's creature
  // name); else "Terminal N" (SESS-024).
  const title = jobTitle || (cwd ? folderName(cwd) : `Terminal${number ? ` ${number}` : ""}`);
  const agentLabel = name ?? (shown === "shell" ? "Plain shell" : programWord(shown));
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
    <section ref={box} className={`pane${focused ? " focused" : ""}${glow || unread ? " glow" : ""}${unread ? " unread" : ""}${card ? " card" : ""}${card?.expanded ? " expanded" : ""}`} hidden={hidden} aria-label={`${title} pane`} onMouseDown={onFocus} data-agent={shown} data-dropping={dropping || undefined} style={{ ...(card?.column ? { gridColumn: card.column } : {}), ...(dropping ? { outline: "2px solid var(--line-focus)", outlineOffset: -2 } : {}) }}>
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
          <VendorMark agent={shown} size={13} />
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
          {name ?? shellName ?? (shown === "shell" && !program && started ? shellWord(started) : programWord(shown))}
          {model && ` · ${model}`}
        </span>
        <span className={`status ${tone}`} data-tip={explain}>
          {word}
        </span>
        {header.state === "permission" && buttonsShown(shown, hook, answered, prompt.current.count, pendingTool) && (
          <span className="answer" role="group" aria-label="Answer the permission prompt">
            {(["approve", "deny"] as const).map((answer) => {
              const drawnAt = prompt.current.count;
              return (
                <button
                  key={answer}
                  className={`btn ${answer === "approve" ? "primary" : ""}`}
                  data-answer={answer}
                  title={answer === "approve" ? "Approve: answers Yes in this agent while its prompt is still showing" : "Deny: backs out of the prompt while it is still showing"}
                  onClick={() => {
                    const keys = answerKeys(shown, answer);
                    setAnswered(drawnAt); // T-151-b: the first click answers; the buttons go until the next prompt
                    if (keys !== null && canAnswer(shown, hook, drawnAt, prompt.current.count, pendingTool)) typeIn.current(keys);
                    else setFlash("The prompt has gone; nothing was sent");
                  }}
                >
                  {answer === "approve" ? "Approve" : "Deny"}
                </button>
              );
            })}
          </span>
        )}
        {flash && (
          <span className="status attention" role="status">
            {flash}
          </span>
        )}
        {linkHint && !flash && (
          <span className="status link-hint" role="status">
            {linkHint}
          </span>
        )}
        {restoredMark && (
          <span className="status attention restored" role="status" title="restored from saved history; a key or a click in the pane clears this">
            {restoredMark}
          </span>
        )}
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
          <ContextGauge context={context} agent={agent} />
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
          <button
            role="menuitem"
            className="menu-item"
            title="Clears the screen and the scrollback of this pane"
            onClick={() => {
              setMenuAt(null);
              clearRef.current();
              termRef.current?.focus();
            }}
          >
            <span className="name">Clear Screen</span>
            <Kbd id="terminal.clear" />
          </button>
          <button
            role="menuitem"
            className="menu-item"
            title="Find text in this pane's screen and scrollback"
            onClick={() => {
              setMenuAt(null);
              findRef.current();
            }}
          >
            <span className="name">Find…</span>
            <Kbd id="terminal.search" />
          </button>
          <button
            role="menuitem"
            className="menu-item"
            title="A scrubbed snapshot of this pane for a bug report, to the clipboard"
            onClick={() => {
              setMenuAt(null);
              void copyDiagnostics();
            }}
          >
            <span className="agent-mark" />
            <span className="name">Copy terminal diagnostics</span>
          </button>
        </PaneMenu>
      )}
      {plusAt && (
        <PlusMenu
          agents={agents}
          dir={cwd ?? undefined}
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
      {finding && <FindBar count={hits.count} current={hits.current} slow={hits.slow} onSearch={runFind} onStep={stepFind} onClose={closeFind} />}
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
      {pasteAsk && !notice && (
        <div className="pane-ask" onMouseDown={(e) => e.stopPropagation()}>
          <div
            className="ask"
            role="alertdialog"
            aria-modal="true"
            aria-label={`Paste ${pasteAsk.lines} lines?`}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                setPasteAsk(null);
                termRef.current?.focus();
              }
            }}
          >
            <h2 className="ask-title">Paste {pasteAsk.lines} lines?</h2>
            <p className="ask-body">Each line runs as you paste it: this program takes pasted lines one by one.</p>
            <div className="btn-row">
              <button
                className="btn primary"
                data-paste="go"
                onClick={() => {
                  const { go } = pasteAsk;
                  setPasteAsk(null);
                  go();
                  termRef.current?.focus();
                }}
              >
                Paste
              </button>
              <button
                className="btn"
                data-paste="cancel"
                autoFocus
                onClick={() => {
                  setPasteAsk(null);
                  termRef.current?.focus();
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {died !== null && !notice && !pasteAsk && (
        <div className="pane-ask" onMouseDown={(e) => e.stopPropagation()}>
          <div
            className="ask"
            role="alertdialog"
            aria-modal="true"
            aria-label="The shell ended"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") closeRef.current?.();
            }}
          >
            <h2 className="ask-title">The shell ended with exit code {died}</h2>
            <p className="ask-body">{exitAdvice(died)}</p>
            <div className="btn-row">
              <button className="btn" onClick={() => closeRef.current?.()}>
                Close pane
              </button>
              <button className="btn primary" autoFocus onClick={() => restart.current(false)}>
                Restart
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** USAGE-001: the header's context ring and percentage. Always there; a greyed 0% until the
 * first reading (a real 0% is a reading), then tinted yellow from 70% and red beyond 90%. */
export function ContextGauge({ context, agent }: { context?: number | null; agent: string }) {
  const none = context === null || context === undefined;
  const percent = none ? 0 : Math.round(context);
  const title = none ? (agent === "shell" ? "Context used (agents only)" : "Context used: nothing received yet. The figure appears with the agent's first status report.") : `Context used: ${percent}% of the agent's context window`;
  return (
    <span className={none ? "gauge none" : `gauge ${toneOf(percent)}`.trim()} title={title}>
      <Ring percent={percent} />
      {percent}%
    </span>
  );
}
