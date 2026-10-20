// T-182 (APP-006): closing the window asks first when work could be lost. The page decides what
// counts: unsaved editor text (VIEW-107) and agents still running (while "ask before closing a
// running terminal" is on, TERM-045's switch). The Rust side only closes for a page that never
// answers the request (frozen past help, or crashed), after its own limit.

export type Losable = { files: string[]; agents: string[] };

/** Agent panes whose program is still running (or still starting: `running` undefined, T-151-c);
 *  a shell pane and an ended agent count for nothing. Empty when the ask is switched off. */
export function runningAgents(panes: { key: number; kind?: string; agent: string; title?: string; word?: string }[], running: Record<number, boolean | undefined>, asks: boolean): string[] {
  if (!asks) return [];
  return panes.filter((p) => !p.kind && p.agent !== "shell" && running[p.key] !== false).map((p) => p.title || p.word || p.agent);
}

/** What closing now would interrupt or lose; null when nothing, so the window closes at once. */
export function losable(files: string[], agents: string[]): Losable | null {
  return files.length === 0 && agents.length === 0 ? null : { files: [...files], agents: [...agents] };
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The confirmation for `l`: files first (lost outright), then agents (interrupted). */
export function quitQuestion(l: Losable): { title: string; body: string; confirm: string } {
  const parts: string[] = [];
  if (l.files.length > 0) parts.push(`${count(l.files.length, "file has", "files have")} unsaved changes: ${l.files.join(", ")}. Quitting now loses them.`);
  if (l.agents.length > 0) parts.push(`${count(l.agents.length, "agent is", "agents are")} still running: ${l.agents.join(", ")}. Quitting now stops ${l.agents.length === 1 ? "it" : "them"}.`);
  const title = l.files.length > 0 ? "Quit with unsaved changes?" : "Quit while agents are running?";
  return { title, body: parts.join(" "), confirm: l.files.length > 0 ? "Quit without saving" : "Quit and stop them" };
}
