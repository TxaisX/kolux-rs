// ACCT-033 (T-311): the model choices for the agent that writes commit messages. The installed tool is
// asked first (scm_writer_options, GIT-018); what it answered is remembered per agent, and when the
// tool cannot be asked the remembered list is shown, else a short built-in list. Pure rules; the
// Settings > Git picker draws the result.
import type { ModelInfo, WriterOptions } from "../scm/writerPick";

/** The settings key that holds the remembered lists: { [agent]: ModelInfo[] }. */
export const WRITER_MODELS_KEY = "commitWriterModelLists";

/** Where a list came from: the installed tool now, the last time it answered, or the built-in list. */
export type ListSource = "installed" | "remembered" | "default";

const named = (...ids: string[]): ModelInfo[] => ids.map((id) => ({ id, name: id, efforts: [] }));

/** Offered when an agent cannot be asked and nothing is remembered. Short, public names only; a blank
 * model always means the agent's own default. Grok is only probed by Kolux, so this is its list. */
export const DEFAULT_MODELS: Readonly<Record<string, ModelInfo[]>> = {
  claude: named("sonnet", "opus", "haiku"),
  codex: named("gpt-5-codex", "gpt-5"),
  cursor: named("auto"),
  grok: named("grok-code-fast-1"),
};

export type WriterLists = Record<string, ModelInfo[]>;

const asModel = (m: unknown): ModelInfo | null => {
  if (!m || typeof m !== "object") return null;
  const { id, name, efforts } = m as Record<string, unknown>;
  if (typeof id !== "string" || id.trim() === "") return null;
  return { id, name: typeof name === "string" && name !== "" ? name : id, efforts: Array.isArray(efforts) ? efforts.filter((e): e is string => typeof e === "string") : [] };
};

/** The remembered lists out of the settings, with anything malformed dropped. */
export function rememberedLists(settings: Record<string, unknown>): WriterLists {
  const raw = settings[WRITER_MODELS_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: WriterLists = {};
  for (const [agent, list] of Object.entries(raw as Record<string, unknown>)) {
    const models = Array.isArray(list) ? list.map(asModel).filter((m): m is ModelInfo => m !== null) : [];
    if (models.length > 0) out[agent] = models;
  }
  return out;
}

/** What to draw for `options`: the live list when the installed tool gave one, else the remembered list,
 * else the built-in one. A missing tool still gets the remembered or built-in list (the picker keeps
 * its "not installed" hint); efforts and the hint are the answer's own. */
export function listFor(options: WriterOptions, remembered: WriterLists): { options: WriterOptions; source: ListSource } {
  if (options.installed && options.models.length > 0) return { options, source: "installed" };
  const kept = remembered[options.agent];
  if (kept && kept.length > 0) return { options: { ...options, models: kept }, source: "remembered" };
  const fallback = DEFAULT_MODELS[options.agent] ?? [];
  return { options: { ...options, models: fallback }, source: "default" };
}

const same = (a: ModelInfo[], b: ModelInfo[]) => a.length === b.length && a.every((m, i) => m.id === b[i].id && m.name === b[i].name && m.efforts.join() === b[i].efforts.join());

/** The settings patch that remembers a live list, or null when it is already remembered (no save loop). */
export function rememberPatch(options: WriterOptions, remembered: WriterLists): Record<string, unknown> | null {
  if (!options.installed || options.models.length === 0) return null;
  if (remembered[options.agent] && same(remembered[options.agent], options.models)) return null;
  return { [WRITER_MODELS_KEY]: { ...remembered, [options.agent]: options.models } };
}

/** The line under the model control for a list that did not come from the installed tool. */
export function sourceNote(source: ListSource, name: string): string | null {
  if (source === "remembered") return `${name} could not be asked just now, so this is the list it gave last time.`;
  if (source === "default") return `${name} could not be asked, so this is a short built-in list. You can still type any model name.`;
  return null;
}
