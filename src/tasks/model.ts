// VIEW-010: the Tasks page, GitHub-only: open issues and pull requests of one repository.
import type { Project } from "../projects/model";
import { sameDir } from "../workspaces";

export type Task = { kind: string; number: number; title: string; url: string; state: string; updated: string; draft: boolean };

/** The checkout whose GitHub repository the page lists: the workspace on screen, else the first project. */
export function tasksRepo(projects: Project[], activeDir: string | null): { dir: string; name: string } | null {
  if (activeDir) return { dir: activeDir, name: projects.find((p) => sameDir(p.path, activeDir))?.name ?? activeDir.split(/[\/]/).filter(Boolean).pop() ?? activeDir };
  return projects[0] ? { dir: projects[0].path, name: projects[0].name } : null;
}

export function taskKind(t: Task): string {
  return t.kind === "issue" ? `Issue #${t.number}` : `${t.draft ? "Draft pull request" : "Pull request"} #${t.number}`;
}
