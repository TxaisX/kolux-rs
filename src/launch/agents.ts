// Which agents the plus menu offers (SESS-001, SESS-004): only the installed ones, the default
// agent first, the rest in catalogue order. Pure, so it is tested without a browser.
import type { AgentInfo } from "./PlusMenu";

/** The settings key that names the default agent by its stable id. */
export const DEFAULT_AGENT_KEY = "defaultAgent";

/** The default agent's id from the settings object; Claude Code when nothing (valid) is set, and
 * "" (no default) once it was cleared, as switching the default agent off does (SET-027). */
export function defaultAgentId(settings: Record<string, unknown> | null | undefined): string {
  const v = settings?.[DEFAULT_AGENT_KEY];
  return typeof v === "string" ? v : "claude";
}

/** The settings key listing the agents switched off on the Agents page (SET-027). */
export const DISABLED_AGENTS_KEY = "disabledAgents";

export function disabledAgents(settings: Record<string, unknown> | null | undefined): string[] {
  const v = settings?.[DISABLED_AGENTS_KEY];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** The agents offered everywhere but Settings: the switched-off ones are left out. */
export function offeredAgents(agents: AgentInfo[], settings: Record<string, unknown> | null | undefined): AgentInfo[] {
  const off = disabledAgents(settings);
  return off.length === 0 ? agents : agents.filter((a) => !off.includes(a.id));
}

/** The settings after switching agent `id` on or off; switching off the default leaves no default. */
export function switchAgent(settings: Record<string, unknown>, id: string, on: boolean): Record<string, unknown> {
  const off = disabledAgents(settings).filter((x) => x !== id);
  const next: Record<string, unknown> = { ...settings, [DISABLED_AGENTS_KEY]: on ? off : [...off, id] };
  if (!on && defaultAgentId(settings) === id) next[DEFAULT_AGENT_KEY] = "";
  return next;
}

/** Installed agents with the default first and the others in catalogue order. */
export function menuAgents(agents: AgentInfo[], defaultId: string): AgentInfo[] {
  const installed = agents.filter((a) => a.installed);
  const first = installed.find((a) => a.id === defaultId);
  return first ? [first, ...installed.filter((a) => a !== first)] : installed;
}
