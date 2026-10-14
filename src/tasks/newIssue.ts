// T-231-d (GIT-046): the draft behind "New issue" in Tasks, kept out of the dialog so its rules are
// tested: it starts on the first selected repository, an unfinished draft comes back, changing
// repository drops the previous one's labels and assignees, and a draft whose repository went away
// falls back to the first selected one.

export type IssueDraft = { repo: string; title: string; body: string; labels: string[]; assignees: string[] };

/** The longest draft (title and body together) Kolux keeps in its settings file. A longer one still
 * creates the issue; it is held in memory for the run instead, so it can be recovered. */
export const DRAFT_MAX = 20_000;

const plain = (p: string) => p !== "" && p !== "." && p !== ".." && /^[A-Za-z0-9_.-]+$/.test(p);
const repoOk = (r: string) => r.split("/").length === 2 && r.split("/").every(plain);
/** github.com's login rule (as github.rs login_ok): letters, digits and `_`, single inner hyphens. */
export const loginOk = (l: string) => l.length <= 79 && /^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*$/.test(l);

export const emptyDraft = (repo: string): IssueDraft => ({ repo, title: "", body: "", labels: [], assignees: [] });

/** The repositories a new issue can go to: the ones the list shows, issues' repository first. */
export const issueTargets = (issues: string, own: string): string[] => [...new Set([issues, own].filter(Boolean))];

/** Another repository: the labels and assignees chosen for the previous one do not carry over. */
export const withRepo = (d: IssueDraft, repo: string): IssueDraft => (repo === d.repo ? d : { ...d, repo, labels: [], assignees: [] });

/** What the dialog opens with: the kept draft, moved to the first target when its repository is gone. */
export function openDraft(saved: IssueDraft | null, targets: string[]): IssueDraft {
  if (!saved) return emptyDraft(targets[0] ?? "");
  return targets.includes(saved.repo) ? saved : withRepo(saved, targets[0] ?? "");
}

/** What to keep in settings: null clears an empty draft, "too-long" means keep it in memory only. */
export function draftToSave(d: IssueDraft): IssueDraft | null | "too-long" {
  if (!d.title.trim() && !d.body.trim() && d.labels.length === 0 && d.assignees.length === 0) return null;
  return d.title.length + d.body.length > DRAFT_MAX ? "too-long" : d;
}

/** A draft read back from settings, or null when it is not one. */
export function draftFrom(v: unknown): IssueDraft | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.repo !== "string" || !repoOk(o.repo) || typeof o.title !== "string" || typeof o.body !== "string") return null;
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && s.trim() !== "") : []);
  return { repo: o.repo, title: o.title, body: o.body, labels: strings(o.labels), assignees: strings(o.assignees).filter(loginOk) };
}
