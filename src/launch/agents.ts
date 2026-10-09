// Which agents the plus menu offers (SESS-001, SESS-004): only the installed ones, the default
// agent first, the rest in catalogue order. Pure, so it is tested without a browser.
import type { AgentInfo } from "./PlusMenu";

/** The settings key that names the default agent by its stable id. */
export const DEFAULT_AGENT_KEY = "defaultAgent";

/** The default agent's id from the settings object; Claude Code when nothing (valid) is set. */
export function defaultAgentId(settings: Record<string, unknown> | null | undefined): string {
  const v = settings?.[DEFAULT_AGENT_KEY];
  return typeof v === "string" && v.length > 0 ? v : "claude";
}

/** Installed agents with the default first and the others in catalogue order. */
export function menuAgents(agents: AgentInfo[], defaultId: string): AgentInfo[] {
  const installed = agents.filter((a) => a.installed);
  const first = installed.find((a) => a.id === defaultId);
  return first ? [first, ...installed.filter((a) => a !== first)] : installed;
}
