// SET-033 / PROJ-035: the setup section of a repository's page. The Rust side (setup.rs) decides which
// script runs and asks the trust question; everything here only shapes what the section shows and
// what a change saves.

/** What `repo_setup_get` returns for one repository. */
export interface RepoSetup {
  /** The script kept in Kolux for this repository. */
  local: string | null;
  /** The setup script in the repository's kolux.yaml. */
  shared: string | null;
  /** Why kolux.yaml could not be read, when it exists but cannot be. */
  sharedError: string | null;
  /** The repository's own choice; null while it inherits. */
  policy: Choice | null;
  /** What it inherits: the global setting. */
  inherited: Choice;
  /** Whether the agent waits for setup to finish before it starts. */
  wait: boolean;
  /** Both scripts exist and no choice is made. */
  suggestBoth: boolean;
  /** Why the choice in force would not run on this PC (two interpreters, or `both` through cmd); null when it would. */
  runError: string | null;
}

export type Choice = "local" | "shared" | "both";
const CHOICES: Choice[] = ["local", "shared", "both"];

const NAME: Record<Choice, string> = { local: "your saved setup, else the shared script", shared: "the shared script only", both: "both, yours first" };

/** What a script draft saves: nothing when it says what is saved already (viewing writes nothing),
 *  "empty" when a saved script was blanked (that is Remove's job, so it is not written silently). */
export type ScriptSave = { kind: "none" } | { kind: "save"; script: string } | { kind: "empty" };

const plain = (s: string) => s.replace(/\r\n/g, "\n").trim();

export function scriptSave(saved: string | null | undefined, draft: string): ScriptSave {
  const next = plain(draft);
  if (next === plain(saved ?? "")) return { kind: "none" };
  return next === "" ? { kind: "empty" } : { kind: "save", script: next };
}

/** The choice in force: the repository's own, else the inherited one. */
export function effectiveChoice(s: RepoSetup): Choice {
  return s.policy ?? s.inherited;
}

/** The run-choice list: first "same as everywhere" naming what that is, then the three choices. */
export function choiceOptions(s: RepoSetup): { value: "" | Choice; label: string }[] {
  return [
    { value: "", label: `Same as everywhere (${NAME[s.inherited]})` },
    { value: "local", label: "Your saved setup (kolux.yaml's runs when there is none)" },
    { value: "shared", label: "The shared script in kolux.yaml only" },
    { value: "both", label: "Both: yours first, then kolux.yaml's" },
  ];
}

/** What picking `value` saves: null when it is what the repository has already or is not a choice. */
export function choiceSave(s: RepoSetup, value: string): { policy: Choice | null } | null {
  if (value === "") return s.policy === null ? null : { policy: null };
  if (!(CHOICES as string[]).includes(value)) return null;
  return value === s.policy ? null : { policy: value as Choice };
}

/** Which scripts actually run, by the rules setup.rs follows. */
function running(s: RepoSetup): { own: boolean; theirs: boolean } {
  const own = !!s.local;
  const theirs = !!s.shared;
  switch (effectiveChoice(s)) {
    case "shared":
      return { own: false, theirs };
    case "both":
      return { own, theirs };
    default:
      return { own, theirs: !own && theirs };
  }
}

/** Whether the repository has a setup script that would run for the choice in force: a read that
 *  asks no trust question and starts nothing (the Guides and Automation probes use it). */
export function hasSetup(s: RepoSetup): boolean {
  // a kolux.yaml that cannot be read is still there to be chosen, as it was for the old probes
  const r = running({ ...s, shared: s.shared ?? (s.sharedError ? s.sharedError : null) });
  return r.own || r.theirs;
}

/** One sentence: what runs when a workspace is made. */
export function runsNote(s: RepoSetup): string {
  if (s.runError) return "Nothing runs until that is fixed.";
  const { own, theirs } = running(s);
  if (own && theirs) return "Runs your saved setup, then the setup script from kolux.yaml.";
  if (own) return effectiveChoice(s) === "local" && s.shared ? "Runs your saved setup; kolux.yaml's setup script is not used." : "Runs your saved setup.";
  if (theirs) return effectiveChoice(s) === "shared" && s.local ? "Runs the setup script from kolux.yaml only; your saved setup is not used." : "Runs the setup script from kolux.yaml.";
  if (effectiveChoice(s) === "shared" && !s.shared) return "Nothing runs: the choice is kolux.yaml's setup script, and it has none.";
  return "Nothing runs: there is no setup script yet.";
}

/** One sentence: which of what runs asks first (SAFE-025). Empty when nothing runs. */
export function trustNote(s: RepoSetup): string {
  if (s.runError) return "";
  const { own, theirs } = running(s);
  const asks = "The script in kolux.yaml asks first, once, and again if it changes.";
  if (own && theirs) return `Your own setup runs without asking. ${asks}`;
  if (own) return "Your own setup runs without asking.";
  return theirs ? asks : "";
}
