// SESS-031, SESS-033, SESS-034, VIEW-087 (T-187-b, T-189-b): the rules every "start an agent for a
// reason" flow shares. Which agent may be started, why one cannot, and what a launch result reports.
// Pure, so every rule is tested without the window. The window supplies the real launch.

/** The part of an agent the flows read. The window's AgentInfo has more fields and fits. */
export type StartAgent = { id: string; name: string; installed: boolean };

/** What the window does to start an agent: opens a tab in `dir` with `prompt` as its opening prompt.
 *  It rejects when the program or the saved arguments cannot be set up. `handed` is false when the
 *  agent started but the prompt could not be handed over (reported apart from a failed launch). */
export type Launch = (agentId: string, dir: string, prompt: string, extra: string[]) => Promise<{ handed: boolean }>;

/** The agents that may be launched: installed (the window already leaves out the switched-off ones). */
export const available = <A extends StartAgent>(agents: A[]): A[] => agents.filter((a) => a.installed);

/** The agent with this id when it may be launched. */
export const findAvailable = <A extends StartAgent>(agents: A[], id: string | null | undefined): A | null => (id ? (available(agents).find((a) => a.id === id) ?? null) : null);

/** SESS-031: the dialog pre-selects the source agent if it is still available, otherwise the saved
 *  default, otherwise the first available agent; null when none is available. */
export function pickTarget<A extends StartAgent>(agents: A[], sourceId: string | null | undefined, defaultId: string | null | undefined): A | null {
  return findAvailable(agents, sourceId) ?? findAvailable(agents, defaultId) ?? available(agents)[0] ?? null;
}

/** SESS-033 / SESS-034: the agent for an action that does not ask. The agent saved for agent actions
 *  when it is available, else the default, else the first available. A saved agent that is switched
 *  off or removed is never the one launched. */
export function pickSaved<A extends StartAgent>(agents: A[], saved: unknown, defaultId: string | null | undefined): A | null {
  return findAvailable(agents, typeof saved === "string" ? saved : null) ?? pickTarget(agents, null, defaultId);
}

export const NO_AGENT = "No agent is installed and switched on, so nothing was started.";

/** Why this agent cannot be launched, or null. */
export const targetBlock = (agents: StartAgent[], id: string, name = id): string | null => (findAvailable(agents, id) ? null : `${name} is not installed or is switched off, so nothing was started.`);

/** SESS-034: per-launch arguments are plain options. A line break, a quote left open or a character a
 *  shell would act on (it could reach cmd.exe through a command shim) is refused. Returns the
 *  arguments split into words, or the plain reason they are refused. */
export function parseArgs(text: string): { args: string[] } | { error: string } {
  if (/[\0\r\n]/.test(text)) return { error: "The launch arguments must be on one line." };
  if (text.length > 1000) return { error: "The launch arguments are too long." };
  const args: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let any = false;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      any = true;
    } else if (/\s/.test(ch)) {
      if (any || cur) args.push(cur);
      cur = "";
      any = false;
    } else if (/[&|;<>`$%^]/.test(ch)) {
      return { error: `The launch arguments cannot contain ${ch}.` };
    } else {
      cur += ch;
    }
  }
  if (quote) return { error: "The launch arguments have a quote that is never closed." };
  if (any || cur) args.push(cur);
  return { args };
}

/** What a flow reports: ok with the folder the agent runs in, or which step stopped and why. */
export type StartResult = { ok: true; dir: string; agent: string } | { ok: false; stage: "agent" | "arguments" | "workspace" | "folder" | "launch" | "prompt"; message: string };

/** A rejected launch, worded for the person. */
export const launchFailed = (agentName: string, err: unknown): string => `${agentName} did not start: ${err instanceof Error ? err.message : String(err)}`;

/** A launch that started the agent but could not hand over its prompt. */
export const promptFailed = (agentName: string, what: string): string => `${agentName} started, but ${what} could not be handed over to it.`;

/** Starts one agent in `dir` with `prompt`, after checking the folder is still there. Never calls
 *  `launch` when the folder is gone; reports a failed launch and a failed hand-over apart. */
export async function startChecked(o: { agent: StartAgent; dir: string; prompt: string; extra?: string[]; what: string; ready: (dir: string) => Promise<void>; launch: Launch }): Promise<StartResult> {
  try {
    await o.ready(o.dir);
  } catch (err) {
    return { ok: false, stage: "folder", message: String(err instanceof Error ? err.message : err) };
  }
  try {
    const r = await o.launch(o.agent.id, o.dir, o.prompt, o.extra ?? []);
    if (!r.handed) return { ok: false, stage: "prompt", message: promptFailed(o.agent.name, o.what) };
  } catch (err) {
    return { ok: false, stage: "launch", message: launchFailed(o.agent.name, err) };
  }
  return { ok: true, dir: o.dir, agent: o.agent.id };
}
