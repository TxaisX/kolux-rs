// ONB-017 / ONB-028 (T-244-b): what "Install CLI & Skills" does, kept apart from the screen so it can be
// tested without one. Three small pieces: the plan a set of ticks makes, the word that says how setup
// ended (installed or needs attention), and the typer that puts the skills installer's command at a
// shell prompt without ever pressing Enter.
import type { Cap, CapId, CliStatus } from "./guide";

/** What the command's registration answers (cli_register.rs `Registration`). */
export type Registration = { state: "registered" | "not-registered" | "unknown" | "conflict"; command: string; place: string; note: string | null; canChange: boolean };

/** The skills this step can install; the CLI command itself is registered, not typed. */
export const SKILL_CAPS: readonly CapId[] = ["kolux-cli", "orchestration"];

export type Plan = {
  /** Register the kolux command for the whole system (T-250-b). */
  register: boolean;
  /** The skills to install with one combined installer command. Only what is ticked, so choosing
   *  orchestration alone never names another skill. */
  skills: string[];
};

/** The plan for the ticked capabilities. A ticked capability that is already ready is left out. */
export function planOf(ticked: readonly CapId[], list: readonly Cap[]): Plan {
  const wanted = (id: CapId) => ticked.includes(id) && !list.find((c) => c.id === id)?.ready;
  return { register: wanted("command"), skills: SKILL_CAPS.filter(wanted) };
}

export const nothingToDo = (p: Plan) => !p.register && p.skills.length === 0;

export type Outcome = { kind: "installed" } | { kind: "attention"; why: string };

/** How the command part of setup ended. Installed only when registration finished cleanly (a change
 *  that did not take never shows success); needs attention when it did not, or when the launcher is
 *  installed but terminals outside Kolux still cannot find it. `done` is what registration answered
 *  (an error string when the call failed); `status` is the PATH check made afterwards. */
export function outcomeOf(done: Registration | string | null, status: CliStatus | null): Outcome {
  if (typeof done === "string") return { kind: "attention", why: done };
  if (done) {
    if (done.state === "registered") return { kind: "installed" };
    if (done.state === "unknown") return { kind: "attention", why: done.note ?? "Kolux could not read your PATH, so it left it alone. Add the command's folder yourself, then Re-check." };
    if (done.state === "conflict") return { kind: "attention", why: done.note ?? `Something that is not Kolux's is already at ${done.place}; Kolux left it alone.` };
    return { kind: "attention", why: done.note ?? "The command was not registered." };
  }
  if (status?.installed && status.onPath) return { kind: "installed" };
  if (status?.installed) return { kind: "attention", why: "The kolux command is installed, but terminals outside Kolux cannot find it." };
  return { kind: "attention", why: "The kolux command was not found next to Kolux." };
}

// ---- the inline terminal's typer ----

export const CHECK_MS = 200;
/** About fifty checks, then it stops waiting rather than polling forever (ONB-017). */
export const MAX_CHECKS = 50;
/** When no prompt text can be read at all, the terminal has been open this long. */
export const OPEN_WAIT_MS = 1500;

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()][0-9A-B]|\u001b[=>]/g;

/** The text a terminal chunk shows: colour codes and window-title codes removed. */
export const plain = (s: string) => s.replace(ANSI, "").replace(/\r(?!\n)/g, "\n");

/** Whether the last line shown ends the way a shell prompt does (bash $ or #, zsh %, PowerShell and cmd >). */
export function promptVisible(shown: string): boolean {
  const lines = shown.split("\n").map((l) => l.replace(/\s+$/g, "")).filter(Boolean);
  const last = lines[lines.length - 1];
  return !!last && /[$#%>]$/.test(last);
}

/** A command goes in as typed text only: a line break would run it. */
export const typable = (cmd: string) => cmd.trim() !== "" && !/[\r\n\u0003\u0004\u001b]/.test(cmd);

export type Typer = {
  /** Output the terminal printed (already decoded). */
  output(text: string): void;
  /** Begin watching for a prompt. */
  start(): void;
  /** Type `cmd` at the prompt, now or as soon as one shows. Typing the same command again does nothing. */
  want(cmd: string): void;
  stop(): void;
  state(): "waiting" | "typed" | "gave-up" | "idle";
};

export type TyperDeps = {
  write: (data: string) => unknown;
  every: (fn: () => void, ms: number) => () => void;
  now: () => number;
};

/** Types `want`ed commands at the shell prompt, never pressing Enter. */
export function createTyper(d: TyperDeps): Typer {
  let shown = "";
  let sawText = false;
  let checks = 0;
  let started = 0;
  let stopWatch: (() => void) | null = null;
  let wanted: string | null = null;
  const sent = new Set<string>();
  let st: ReturnType<Typer["state"]> = "idle";

  const halt = () => {
    stopWatch?.();
    stopWatch = null;
  };
  const type = () => {
    if (wanted === null || sent.has(wanted)) return;
    sent.add(wanted);
    st = "typed";
    halt();
    void d.write(wanted);
  };
  const check = () => {
    if (wanted === null) return;
    checks++;
    if (promptVisible(shown) || (!sawText && d.now() - started >= OPEN_WAIT_MS)) return type();
    if (checks >= MAX_CHECKS) {
      st = "gave-up";
      halt();
    }
  };
  const start = () => {
    if (stopWatch) return;
    started = d.now();
    checks = 0;
    st = "waiting";
    stopWatch = d.every(check, CHECK_MS);
  };
  return {
    output(text) {
      const p = plain(text);
      if (p.trim()) sawText = true;
      shown = (shown + p).slice(-600);
    },
    start,
    want(cmd) {
      if (!typable(cmd) || sent.has(cmd)) return;
      wanted = cmd;
      if (st === "typed" || st === "gave-up") st = "idle";
      if (st === "idle") start();
    },
    stop() {
      halt();
      st = "idle";
    },
    state: () => st,
  };
}
