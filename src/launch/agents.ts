// Which agents the plus menu offers (SESS-001, SESS-004): only the installed ones, the default
// agent first, the rest in catalogue order. Pure, so it is tested without a browser.
import type { AgentInfo } from "./PlusMenu";

/** The settings key that names the default agent by its stable id. */
export const DEFAULT_AGENT_KEY = "defaultAgent";

/** The default agent's id from the settings object; "" (no default, so lists keep catalogue order)
 * on a fresh install (SESS-010) and once it was cleared, as switching the default agent off does (SET-027). */
export function defaultAgentId(settings: Record<string, unknown> | null | undefined): string {
  const v = settings?.[DEFAULT_AGENT_KEY];
  return typeof v === "string" ? v : "";
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

/** SESS-003: some agent is installed, yet every installed one is switched off. */
export function allSwitchedOff(all: AgentInfo[], settings: Record<string, unknown> | null | undefined): boolean {
  const installed = all.filter((a) => a.installed);
  return installed.length > 0 && offeredAgents(installed, settings).length === 0;
}

/** SESS-002: where the agent search stands. Nothing counts as not installed before the first
 * pass is done, and an errored pass blocks launching until one succeeds. */
export type AgentPass = { looking: boolean; done: boolean; error: string | null };
export const FIRST_PASS: AgentPass = { looking: true, done: false, error: null };
export const canLaunch = (p: AgentPass): boolean => p.done && p.error === null;

/** Installed agents with the default first and the others in catalogue order. */
export function menuAgents(agents: AgentInfo[], defaultId: string): AgentInfo[] {
  const installed = agents.filter((a) => a.installed);
  const first = installed.find((a) => a.id === defaultId);
  return first ? [first, ...installed.filter((a) => a !== first)] : installed;
}
