// GIT-019 (T-313-b): Source Control AI actions tuned per action and per repository. A recipe says how
// one action (the commit message, the pull request text, a branch name, a fix) is run: by an agent
// with extra command-line arguments, or by a command template. Variables are written {name}. This
// holds the rules: which variables an action offers, why a recipe cannot be saved, how a
// configuration from before recipes existed becomes recipes, and whether a repository shows the AI
// actions (it follows the global switch, or is forced on or off).
import { aiControlsShown, genDefaultsOf, type GenDefaults } from "./rules";

export type RecipeAction = "commit" | "pr" | "branch" | "fix";
export const RECIPE_ACTIONS: { id: RecipeAction; label: string }[] = [
  { id: "commit", label: "Commit message" },
  { id: "pr", label: "Pull request text" },
  { id: "branch", label: "Branch name" },
  { id: "fix", label: "Fix with AI" },
];

/** What a recipe runs: an agent with extra arguments, or a command template (not both). */
export type Recipe = { agent: string | null; args: string; template: string };
export type Recipes = Partial<Record<RecipeAction, Recipe>>;

const COMMON = ["diff", "branch", "base", "files"];
/** The variable chips an action offers; the linked issue only where text about the change is written. */
export const recipeVariables = (action: RecipeAction): string[] => (action === "commit" || action === "pr" ? [...COMMON, "issue"] : action === "fix" ? [...COMMON, "output"] : COMMON);

/** Why the recipe cannot be saved, or null. */
export function recipeProblem(action: RecipeAction, r: Recipe): string | null {
  const agent = r.agent?.trim() ?? "";
  const args = r.args.trim();
  const template = r.template.trim();
  if (agent && template) return "Choose an agent or a command template, not both.";
  if (!agent && !template) return args ? "Extra arguments need an agent to go to." : "Choose an agent or write a command template.";
  if (/[\0\r\n]/.test(r.args + r.template)) return "A recipe is a single line.";
  const text = `${args} ${template}`;
  const open = (text.match(/\{/g) ?? []).length;
  const close = (text.match(/\}/g) ?? []).length;
  if (open !== close) return "A variable is missing its closing or opening brace.";
  const allowed = recipeVariables(action);
  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    const name = m[1];
    if (name === "issue" && !allowed.includes("issue")) return "{issue} is only available in the commit and pull request recipes.";
    if (!allowed.includes(name)) return `{${name}} is not a variable of this recipe. Available: ${allowed.map((v) => `{${v}}`).join(", ")}.`;
  }
  return null;
}

export const RECIPES_KEY = "scmRecipes";

/** The saved recipes, keeping only well-formed ones. */
export function recipesOf(v: unknown): Recipes {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const out: Recipes = {};
  for (const { id } of RECIPE_ACTIONS) {
    const r = o[id];
    if (typeof r !== "object" || r === null) continue;
    const x = r as Record<string, unknown>;
    const recipe: Recipe = { agent: typeof x.agent === "string" && x.agent ? x.agent : null, args: typeof x.args === "string" ? x.args : "", template: typeof x.template === "string" ? x.template : "" };
    if (recipeProblem(id, recipe) === null) out[id] = recipe;
  }
  return out;
}

/**
 * First launch after recipes exist: the one agent chosen for every repository before becomes the
 * recipe of the commit message and pull request text actions. Recipes already saved win, and a
 * configuration with nothing to carry over yields nothing (so it is not written again).
 */
export function migrateRecipes(settings: Record<string, unknown> | null): Recipes | null {
  if (settings === null || settings[RECIPES_KEY] !== undefined) return null;
  const legacy: GenDefaults = genDefaultsOf(settings.scmGenDefaults);
  if (legacy.all === null) return null;
  const r: Recipe = { agent: legacy.all.agent, args: "", template: "" };
  return { commit: { ...r }, pr: { ...r } };
}

// ---- per repository ---------------------------------------------------------------------------

export type RepoAiMode = "follow" | "on" | "off";
export const REPO_AI_KEY = "scmRepoAi";

/** A repository's mode; anything but the two forcing values follows the global choice. */
export function repoAiMode(settings: Record<string, unknown> | null, repo: string): RepoAiMode {
  const m = (settings?.[REPO_AI_KEY] as Record<string, unknown> | undefined)?.[repo];
  return m === "on" || m === "off" ? m : "follow";
}

/** Do the AI actions show for this repository: forced on or off, else the one global switch. */
export function aiShownFor(settings: Record<string, unknown> | null, repo: string | null): boolean {
  const mode = repo === null ? "follow" : repoAiMode(settings, repo);
  return mode === "on" ? true : mode === "off" ? false : aiControlsShown(settings);
}

/** The saved per-repository modes with `repo` set; "follow" removes its entry. */
export function withRepoAi(settings: Record<string, unknown> | null, repo: string, mode: RepoAiMode): Record<string, RepoAiMode> {
  const now = { ...((settings?.[REPO_AI_KEY] as Record<string, RepoAiMode> | undefined) ?? {}) };
  if (mode === "follow") delete now[repo];
  else now[repo] = mode;
  return now;
}
