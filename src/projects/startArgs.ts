import type { CliWorkspace } from "./model";

/** T-172-e: the variable a worker start puts in its first session's environment (the runtime's DISPATCH_ENV). */
export const DISPATCH_ENV = "KOLUX_DISPATCH_ID";

type StartLine = [string, string][];

/**
 * cli FIX-7: the environment the agent's first session starts with. A worker start (it has a
 * dispatch id) ends the list with its own KOLUX_DISPATCH_ID, and any entry for that name the
 * agent's settings already held is dropped, so the runtime reads the real dispatch and a value the
 * user set can never stand in for it. A start with no dispatch (a tab the user opens) is unchanged.
 */
export function sessionEnv(env: StartLine, dispatch?: string): StartLine {
  if (!dispatch) return env;
  return [...env.filter(([k]) => k !== DISPATCH_ENV), [DISPATCH_ENV, dispatch]];
}

/** What the "start" notice from the runtime hands startIn after the folder: prompt, show, extra, title, dispatch. */
export function startTail(p: Extract<CliWorkspace, { kind: "start" }>): [string, boolean, string[], string | undefined, string | undefined] {
  return [p.prompt, false, p.extra, p.title ?? undefined, p.dispatch];
}
