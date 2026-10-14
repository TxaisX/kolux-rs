// T-231-d (GIT-046): the draft behind "New issue" in Tasks, kept out of the dialog so its rules are
// tested: it starts on the first selected repository, an unfinished draft comes back, changing
// repository drops the previous one's labels and assignees, and a draft whose repository went away
// falls back to the first selected one. FIX-2 (council FS 1-2, AFTER 2): a draft belongs to one
// GitHub host, one create runs at a time across close and reopen, and closing keeps typed text.

export type IssueDraft = { host: string; repo: string; title: string; body: string; labels: string[]; assignees: string[] };

/** The longest draft (title and body together) Kolux keeps in its settings file. A longer one still
 * creates the issue; it is held in memory for the run instead, so it can be recovered. */
export const DRAFT_MAX = 20_000;

const plain = (p: string) => p !== "" && p !== "." && p !== ".." && /^[A-Za-z0-9_.-]+$/.test(p);
const repoOk = (r: string) => r.split("/").length === 2 && r.split("/").every(plain);
/** A plain host name (as github.rs host_ok): letters, digits, `.`, `-`, `:`, never a leading `-`. */
const hostOk = (h: string) => h !== "" && !h.startsWith("-") && /^[A-Za-z0-9.:-]+$/.test(h);
const sameHost = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** github.com's login rule (as github.rs login_ok): letters, digits and `_`, single inner hyphens. */
export const loginOk = (l: string) => l.length <= 79 && /^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*$/.test(l);

/** Comma-separated names, trimmed, each once. */
export const names = (s: string) => [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))];

export const emptyDraft = (host: string, repo: string): IssueDraft => ({ host, repo, title: "", body: "", labels: [], assignees: [] });

/** The repositories a new issue can go to: the ones the list shows, issues' repository first. */
export const issueTargets = (issues: string, own: string): string[] => [...new Set([issues, own].filter(Boolean))];

/** Another repository: the labels and assignees chosen for the previous one do not carry over. */
export const withRepo = (d: IssueDraft, repo: string): IssueDraft => (repo === d.repo ? d : { ...d, repo, labels: [], assignees: [] });

/** What the dialog opens with: the kept draft, moved to the first target when its repository is
 * gone. A draft made for another GitHub host is never aimed here (a same-named repository on
 * github.com is not the Enterprise one): the dialog starts empty and says where that draft is. */
export function openDraft(saved: IssueDraft | null, targets: string[], host: string): { draft: IssueDraft; elsewhere: IssueDraft | null } {
  const first = targets[0] ?? "";
  if (!saved) return { draft: emptyDraft(host, first), elsewhere: null };
  if (!sameHost(saved.host, host)) return { draft: emptyDraft(host, first), elsewhere: saved };
  return { draft: targets.includes(saved.repo) ? saved : withRepo(saved, first), elsewhere: null };
}

/** The draft as it stands when the dialog closes: label and assignee text typed but never left
 * (blurred) is taken in, so it is kept too. */
export const closingDraft = (d: IssueDraft, labelText: string, peopleText: string): IssueDraft => ({ ...d, labels: names(labelText), assignees: names(peopleText) });

/** What to keep in settings: null clears an empty draft, "too-long" means keep it in memory only. */
export function draftToSave(d: IssueDraft): IssueDraft | null | "too-long" {
  if (!d.title.trim() && !d.body.trim() && d.labels.length === 0 && d.assignees.length === 0) return null;
  return d.title.length + d.body.length > DRAFT_MAX ? "too-long" : d;
}

/** A draft read back from settings, or null when it is not one (one without a host is not one). */
export function draftFrom(v: unknown): IssueDraft | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.host !== "string" || !hostOk(o.host) || typeof o.repo !== "string" || !repoOk(o.repo) || typeof o.title !== "string" || typeof o.body !== "string") return null;
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && s.trim() !== "") : []);
  return { host: o.host, repo: o.repo, title: o.title, body: o.body, labels: strings(o.labels), assignees: strings(o.assignees).filter(loginOk) };
}

// FIX-2 (council FS 1): one create at a time for the whole run, not per dialog, so closing the
// dialog while "Creating…" and opening it again can never send the same issue twice.
export type CreateEvent = "busy" | "created" | "failed";
let inFlight = false;
const watchers = new Set<(e: CreateEvent) => void>();
const tell = (e: CreateEvent) => watchers.forEach((w) => w(e));

/** True while a create is out. */
export const createBusy = () => inFlight;

/** Calls `w` when a create starts ("busy") and when it settles; returns the unsubscribe. */
export function watchCreate(w: (e: CreateEvent) => void): () => void {
  watchers.add(w);
  return () => void watchers.delete(w);
}

/** Sends one create, or nothing (null) when another is still out. */
export async function createOnce<T>(send: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string } | null> {
  if (inFlight) return null;
  inFlight = true;
  tell("busy");
  try {
    const value = await send();
    inFlight = false;
    tell("created");
    return { ok: true, value };
  } catch (e) {
    inFlight = false;
    tell("failed");
    return { ok: false, error: String(e) };
  }
}
