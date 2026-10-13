// VIEW-010 / GIT-043: the Tasks page, GitHub-only: issues and pull requests found by GitHub search.
import type { Project } from "../projects/model";
import { sameDir } from "../workspaces";

export type TaskLabel = { name: string; color: string };
export type Task = { kind: string; number: number; title: string; url: string; repo: string; state: string; draft: boolean; labels: TaskLabel[]; assignees: string[]; updated: string; checks: string | null };
export type TaskPage = { total: number; deepest: number; items: Task[] };

/** The checkout whose GitHub repository the page lists: the workspace on screen, else the first project. */
export function tasksRepo(projects: Project[], activeDir: string | null): { dir: string; name: string } | null {
  if (activeDir) return { dir: activeDir, name: projects.find((p) => sameDir(p.path, activeDir))?.name ?? activeDir.split(/[\/]/).filter(Boolean).pop() ?? activeDir };
  return projects[0] ? { dir: projects[0].path, name: projects[0].name } : null;
}

export function taskKind(t: Pick<Task, "kind" | "draft" | "number">): string {
  return t.kind === "issue" ? `Issue #${t.number}` : `${t.draft ? "Draft pull request" : "Pull request"} #${t.number}`;
}

type Kind = "issue" | "pr";
/** GIT-043: the presets; the first (everything open) is VIEW-010's default. */
export const PRESETS: { id: string; label: string; q: string; kinds: Kind[] }[] = [
  { id: "all", label: "All open", q: "is:open", kinds: ["issue", "pr"] },
  { id: "mine", label: "Created by me", q: "is:open author:@me", kinds: ["issue", "pr"] },
  { id: "assigned", label: "Assigned to me", q: "is:open assignee:@me", kinds: ["issue", "pr"] },
  { id: "review", label: "Needs my review", q: "is:open review-requested:@me", kinds: ["pr"] },
  { id: "mentioned", label: "Mentions me", q: "is:open mentions:@me", kinds: ["issue", "pr"] },
  { id: "closed", label: "Recently closed", q: "is:closed", kinds: ["issue", "pr"] },
];

/** GIT-043: the GitHub searches for a preset, a typed query and the chosen repositories (owner/name):
 * one per kind the preset shows, unless the query names is:issue or is:pr itself. */
export function taskQueries(preset: string, typed: string, repos: string[]): string[] {
  if (repos.length === 0) return [];
  const p = PRESETS.find((x) => x.id === preset) ?? PRESETS[0];
  const words = typed.trim().split(/\s+/).filter(Boolean);
  const named = words.some((w) => /^(is|type):(issue|pr|pull-request)$/i.test(w));
  const tail = [...words, ...repos.map((r) => `repo:${r}`)].join(" ");
  return named ? [`${p.q} ${tail}`] : p.kinds.map((k) => `is:${k} ${p.q} ${tail}`);
}

export const PER_PAGE = 25;
const WINDOW = 1000;
/** Pages there are to show; GitHub search hands out its first 1000 results only. */
export const pageCount = (deepest: number) => Math.max(1, Math.ceil(Math.min(deepest, WINDOW) / PER_PAGE));
export const beyondWindow = (deepest: number) => deepest > WINDOW;

/** Numbered page buttons: the first, the last and two either side of the current; null is a gap. */
export function pageButtons(page: number, count: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let n = 1; n <= count; n++) {
    if (n === 1 || n === count || Math.abs(n - page) <= 2) out.push(n);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
}

export type TaskEvent = { kind: string; actor: string; at: string; detail: string };
export type TaskDetail = { title: string; body: string; state: string; labels: TaskLabel[]; assignees: string[]; updated: string; events: TaskEvent[] };

/** GIT-050: one timeline event in words, such as "@txais added the label bug". */
export function eventLine(e: TaskEvent): string {
  const d = e.detail;
  const verbs: Record<string, string> = {
    labeled: `added the label ${d}`,
    unlabeled: `removed the label ${d}`,
    assigned: d === e.actor ? "self-assigned this" : `assigned @${d}`,
    unassigned: d === e.actor ? "unassigned themselves" : `unassigned @${d}`,
    review_requested: `asked @${d} for a review`,
    review_request_removed: `took back the review request for @${d}`,
    closed: "closed this",
    reopened: "reopened this",
    merged: "merged this",
    mentioned: "was mentioned",
    renamed: `renamed this: ${d}`,
    commented: `commented: ${d}`,
    reviewed: d ? `reviewed: ${d}` : "reviewed",
    committed: `committed ${d}`,
    "cross-referenced": `mentioned this in ${d}`,
    referenced: `referenced this in commit ${d}`,
  };
  const verb = verbs[e.kind] ?? e.kind.replace(/[_-]/g, " ");
  return e.actor ? `@${e.actor} ${verb}` : verb;
}
