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

/** A repository as the switch knows it: the provider-neutral id (scm_repo_id) a write goes to, the `owner/name` key a repository was saved under before ids existed (any host the remote parser read), and `also`, its root path, which an "off" is written under too so it survives a remote change. Never another remote's key. A bare string is an id. */
export type RepoRef = string | { id: string; legacy?: string | null; also?: string[] };
const idOf = (r: RepoRef): string => (typeof r === "string" ? r : r.id);
/** Every key the repository may have been saved under, the primary id first. */
const keysOf = (r: RepoRef): string[] => (typeof r === "string" ? [r] : [r.id, ...(r.also ?? []), ...(r.legacy ? [r.legacy] : [])]);
const savedModes = (settings: Record<string, unknown> | null): Record<string, unknown> => (settings?.[REPO_AI_KEY] as Record<string, unknown> | undefined) ?? {};

/** A repository's mode: an "off" under any of its keys wins, else an "on" under any; anything else follows the global choice. */
export function repoAiMode(settings: Record<string, unknown> | null, repo: RepoRef): RepoAiMode {
  const saved = savedModes(settings);
  const modes = keysOf(repo).map((k) => saved[k]);
  return modes.includes("off") ? "off" : modes.includes("on") ? "on" : "follow";
}

/** A repository read for `dir`: another folder's answer is dropped (null fails closed) rather than shown for one frame. */
export function refForDir(state: { dir: string; ref: RepoRef | null } | null, dir: string): RepoRef | null {
  return state !== null && state.dir === dir ? state.ref : null;
}

/**
 * Do the AI actions show for this repository: forced on or off, else the one global switch. A null
 * repository is one whose id could not be read: it fails closed while any repository is switched
 * off (it may be that one), else it follows the global switch.
 */
export function aiShownFor(settings: Record<string, unknown> | null, repo: RepoRef | null): boolean {
  if (repo === null) return Object.values(savedModes(settings)).includes("off") ? false : aiControlsShown(settings);
  const mode = repoAiMode(settings, repo);
  return mode === "on" ? true : mode === "off" ? false : aiControlsShown(settings);
}

/**
 * The saved per-repository modes with `repo` set. Only the repository's own keys are touched, never
 * another remote's (a fork must not wipe its upstream's switch). "off" is written under the primary
 * id and its root path (so it survives a remote change); "on" under the primary id; "follow" removes
 * the own keys.
 */
export function withRepoAi(settings: Record<string, unknown> | null, repo: RepoRef, mode: RepoAiMode): Record<string, RepoAiMode> {
  const now = { ...(savedModes(settings) as Record<string, RepoAiMode>) };
  for (const k of keysOf(repo)) delete now[k];
  if (mode === "off") for (const k of typeof repo === "string" ? [repo] : [repo.id, ...(repo.also ?? [])]) now[k] = "off";
  else if (mode === "on") now[idOf(repo)] = "on";
  return now;
}

// ---- running a recipe (T-313-b) -----------------------------------------------------------------
// The expansion of {variables} and the composed command live on the Rust side (scm_recipe.rs); this
// only picks the recipe an action runs and shapes what the front end hands to the app's own launch.

/** The saved recipe an action runs, or null (then the single writer chosen in settings is used). */
export function recipeFor(settings: Record<string, unknown> | null, action: RecipeAction): Recipe | null {
  return recipesOf(settings?.[RECIPES_KEY])[action] ?? null;
}

/** The usual request Fix with AI starts an agent with. */
export const fixRequest = (output: string): string => `A git action in this workspace failed. Find the cause, fix it, and finish the action.\n\nGit said:\n${output}`;

/** What a Fix with AI recipe hands the app: the agent to start, its extra arguments and the request. */
export type FixLaunch = { agent: string; extra: string[]; prompt: string };
/** The back end's answer for Fix with AI: an agent to start, or the text a command template printed. */
export type FixPlan = ({ kind: "agent" } & FixLaunch) | { kind: "ran"; text: string };
