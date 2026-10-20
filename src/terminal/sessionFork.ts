// TERM-037 (T-219): Continue in new session, Fork Agent Session and Copy Context in the pane menu.
// Pure: which panes qualify, the program and arguments each action starts, the fork dialog's
// once-only create, and the text Copy Context puts on the clipboard. The flags are the agents' own
// documented ones: Claude Code `--resume <id>` (+ `--fork-session`), Codex `codex resume <id>` and
// `codex fork <id>` (each tool's `--help` and public docs).
export type SessionPane = { agent: string; session?: string; program: string | null; args: string[]; kind?: string; seats?: unknown; cwd?: string | null; branch?: string | null; title?: string };

const RESUMABLE = ["claude", "codex"];

/** Continue / Fork / Copy Context show only for an agent pane whose session id is known and can be continued. */
export const canContinue = (p: SessionPane): boolean => !!p.session && !p.kind && !p.seats && RESUMABLE.includes(p.agent);

/** The pane's own arguments without any resume, continue or fork flags it started with. */
export function baseArgs(agent: string, args: string[]): string[] {
  if (agent === "codex") return args[0] === "resume" || args[0] === "fork" ? args.slice(args[1] && !args[1].startsWith("-") ? 2 : 1) : [...args];
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--resume" || a === "-r") i++; // takes an id
    else if (a === "--continue" || a === "-c" || a === "--fork-session" || a.startsWith("--resume=")) continue;
    else out.push(a);
  }
  return out;
}

export type Launch = { program: string; args: string[] };

/** Continue in new session: the same conversation resumed in a second pane. */
export function continueLaunch(p: SessionPane): Launch | null {
  if (!canContinue(p) || !p.session) return null;
  const base = baseArgs(p.agent, p.args);
  const program = p.program ?? p.agent;
  return p.agent === "codex" ? { program, args: ["resume", p.session, ...base] } : { program, args: [...base, "--resume", p.session] };
}

/** Fork Agent Session: a new session that starts from this one's history and then goes its own way. */
export function forkLaunch(p: SessionPane): Launch | null {
  if (!canContinue(p) || !p.session) return null;
  const base = baseArgs(p.agent, p.args);
  const program = p.program ?? p.agent;
  return p.agent === "codex" ? { program, args: ["fork", p.session, ...base] } : { program, args: [...base, "--resume", p.session, "--fork-session"] };
}

export type SessionAction = { id: "continueSession" | "forkSession" | "copyContext"; name: string; title: string };

/** The three pane-menu items for a pane, empty when its session cannot be continued. */
export const sessionActions = (p: SessionPane): SessionAction[] =>
  canContinue(p)
    ? [
        { id: "continueSession", name: "Continue in new session", title: "Opens a second pane that resumes this conversation" },
        { id: "forkSession", name: "Fork Agent Session…", title: "Sets up a new session that starts from this one's history" },
        { id: "copyContext", name: "Copy Context", title: "Copies a text summary of this session for pasting elsewhere" },
      ]
    : [];

/** The fork dialog: pressing Create while it is already working starts nothing more. */
export type ForkDraft = { name: string; busy: boolean };
export const newFork = (name = ""): ForkDraft => ({ name, busy: false });
export function beginFork(d: ForkDraft): { draft: ForkDraft; go: boolean } {
  return d.busy ? { draft: d, go: false } : { draft: { ...d, busy: true }, go: true };
}
export const endFork = (d: ForkDraft): ForkDraft => ({ ...d, busy: false });

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const MAX_LINES = 40;
const MAX_CHARS = 8000;

/** Copy Context: who and where, then the last lines the pane showed; capped so a paste stays small. */
export function contextText(p: SessionPane & { label?: string }, o: { status?: string; recent?: string[] }): string {
  const head = [`Agent session: ${p.label ?? p.agent}`, p.cwd ? `Folder: ${p.cwd}` : "", p.branch ? `Branch: ${p.branch}` : "", p.session ? `Session id: ${p.session}` : "", p.title ? `Title: ${p.title}` : "", o.status ? `Status: ${o.status}` : ""].filter(Boolean);
  const lines = (o.recent ?? []).map((l) => l.replace(ANSI, "").trimEnd()).filter((l) => l.trim() !== "");
  const tail = lines.slice(-MAX_LINES);
  const text = [...head, ...(tail.length ? ["", "Recent output:", ...tail] : [])].join("\n");
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[cut]` : text;
}
