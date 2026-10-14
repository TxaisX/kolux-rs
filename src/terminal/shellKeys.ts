// TERM-079: which keys the pane keeps for Kolux and which reach the shell. Policy: Kolux first. A chord
// bound to a Kolux action (defaults or the user's own keybindings file, in the global, terminal or tab
// scopes) is Kolux's and the shell never sees it; everything else goes to the program as the terminal
// encodes it, so Ctrl+R opens the shell's history search and, on Windows, Ctrl+Arrow moves by word.
// Carve-outs: Ctrl+C with nothing selected is the program's interrupt (TERM-065); on macOS the shell's own
// Ctrl editing chords (Ctrl+A/E/K/U/W/R and the rest) stay the shell's even when a Kolux chord names them,
// Cmd+Left/Right jump to line start/end and Cmd+Up/Down to the top/bottom of scrollback; Alt+Arrow moves by
// word on every platform: the readline word moves (ESC b / ESC f) on macOS and Linux, and on Windows the
// Ctrl+Arrow key encoding, which PSReadLine (no ESC b binding in its Windows mode) and Git Bash both read. A key that is part
// of an input method's composition (TERM-083) is never routed: the terminal's composition handling owns it.
import type { Agent } from "../chrome/VendorMark";
import { matchEvent, type KeyLike, type Keymap } from "../keys/keymap";
import { shellKind } from "./drop";

export type Route =
  | { kind: "ime" }
  | { kind: "kolux"; id: string }
  | { kind: "shell" }
  | { kind: "send"; data: string }
  | { kind: "scroll"; to: "top" | "bottom" };

export type RoutedKey = KeyLike & { isComposing?: boolean; keyCode?: number };

const WORD_MOVES: Record<string, string> = { ArrowLeft: "\x1bb", ArrowRight: "\x1bf" };
// Windows: PSReadLine's Windows mode has no ESC b binding, so Alt+Arrow sends the Ctrl+Arrow key encoding,
// which PSReadLine, cmd's line editor and Git Bash's readline all move by word on.
const WORD_MOVES_WIN: Record<string, string> = { ArrowLeft: "\x1b[1;5D", ArrowRight: "\x1b[1;5C" };
const LINE_JUMPS: Record<string, string> = { ArrowLeft: "\x01", ArrowRight: "\x05" };

/** TERM-080: Shift+Enter (and Ctrl+Enter) in an agent pane is a newline, sent the way that agent reads one: Claude
 *  Code takes ESC CR (what its own terminal setup binds), Codex takes Ctrl+J (a bare line feed). A shell keeps
 *  plain Enter: it has no multi-line prompt to feed. Alt and Cmd variants are left to the keymap and the shell. */
/** Council D2 MERGE 47 FS1: whose newline Shift+Enter sends, from the program that really started. An agent
 *  pane that fell back to a shell (Codex missing, bash started) is a shell: a newline there would run a
 *  half-typed command. Before anything started, the pane's agent. */
export const newlineAgent = (started: string | null | undefined, agent: Agent): Agent => (shellKind(started) === "other" ? agent : "shell");

export function newlineFor(agent: Agent, e: RoutedKey): Route | null {
  if (agent === "shell" || e.key !== "Enter" || e.altKey || e.metaKey || e.shiftKey === e.ctrlKey) return null;
  return { kind: "send", data: agent === "claude" ? "\x1b\r" : "\n" };
}

export function routeKey(map: Keymap, e: RoutedKey, hasSelection: boolean, agent: Agent = "shell", held: (id: string) => boolean = () => false): Route {
  if (e.isComposing || e.keyCode === 229) return { kind: "ime" };
  const mac = map.platform === "darwin";
  const only = (mod: "alt" | "meta" | "ctrl") => e.altKey === (mod === "alt") && e.metaKey === (mod === "meta") && e.ctrlKey === (mod === "ctrl") && !e.shiftKey;
  if (only("alt") && e.key in WORD_MOVES) return { kind: "send", data: (map.platform === "win32" ? WORD_MOVES_WIN : WORD_MOVES)[e.key] };
  if (mac && only("meta")) {
    if (e.key in LINE_JUMPS) return { kind: "send", data: LINE_JUMPS[e.key] };
    if (e.key === "ArrowUp") return { kind: "scroll", to: "top" };
    if (e.key === "ArrowDown") return { kind: "scroll", to: "bottom" };
  }
  if (mac && only("ctrl") && /^Key[A-Z]$/.test(e.code)) return { kind: "shell" };
  const hit = matchEvent(map, e, ["global", "terminal", "tabs"]);
  if (!hit) return newlineFor(agent, e) ?? { kind: "shell" };
  // Council D2 MERGE 47 FB1: a chord the user gave to the terminal ("Terminal first") reaches the program.
  if (held(hit.id)) return { kind: "shell" };
  if (hit.id === "terminal.copySelection" && !hasSelection && !e.shiftKey && !e.metaKey) return { kind: "shell" };
  return { kind: "kolux", id: hit.id };
}

/** T-151-b (council D2 MERGE 47 S2): a keydown that reaches the program answers a permission prompt as far as the
 *  Approve/Deny buttons go; a Kolux chord, a scroll jump or a bare modifier does not. Read from the key handler,
 *  not onData, which also carries xterm's own focus, mouse and cursor-position replies. */
export const answersPrompt = (route: Route, key: string) =>
  (route.kind === "shell" || route.kind === "send" || route.kind === "ime") && !["Shift", "Control", "Alt", "Meta"].includes(key);
