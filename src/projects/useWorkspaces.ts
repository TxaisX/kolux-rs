// T-543: the window's projects and workspaces, moved out of App.tsx as they were. Two hooks, called
// where the code used to sit: useWorkspaces holds the lists and requests (the window's state slot),
// useWorkspaceActions opens, sets up and removes workspaces over the window's panes (the slot where
// the setup terminal's code was). The grid's own state (stacked pairs, weights) stays in the window.
import { useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Pane } from "../App";
import type { Screen } from "../chrome/TopBar";
import type { Page } from "./ProjectsPanel";
import type { PendingCreate, Project, SetupLine, SetupWhere } from "./model";
import { EMPTY_HISTORY } from "./nav";
import { cellsOf, DEFAULT_PANES_FIELD, groupOf, MAX_PANES, seedCount } from "../terminal/grid";
import { activeAfterRemove, focusIn, panesIn, sameDir, withoutDir } from "../workspaces";
import { readLook } from "../settings/general";
import { emptySeat } from "../launch/seats";

export function useWorkspaces(activeDir: string | null) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [owner, setOwner] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({}); // workspace folder -> the name typed for it (PROJ-021)
  const [refresh, setRefresh] = useState(0);
  const [deleteRequest, setDeleteRequest] = useState(0); // PROJ-070: Mod+Shift+Backspace asks to delete the shown workspace
  const recentDirs = useRef<string[]>([]); // PROJ-070: workspaces shown, newest first
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeDir;
  const [createRequest, setCreateRequest] = useState(0); // PROJ-020: Mod+N opens the sidebar's name field
  const [standIns, setStandIns] = useState<PendingCreate[]>([]); // PROJ-020: creates Git is still working on
  const [createName, setCreateName] = useState(""); // PROJ-057: the palette's typed name, prefilled there
  const [hist, setHist] = useState(EMPTY_HISTORY); // VIEW-046: workspaces and pages shown, for back and forward
  return { projects, setProjects, owner, setOwner, names, setNames, refresh, setRefresh, deleteRequest, setDeleteRequest, recentDirs, activeRef, createRequest, setCreateRequest, standIns, setStandIns, createName, setCreateName, hist, setHist };
}

type ActionDeps = {
  panes: Pane[];
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  setFocused: Dispatch<SetStateAction<number>>;
  setActiveDir: Dispatch<SetStateAction<string | null>>;
  setStacked: Dispatch<SetStateAction<Record<string, boolean>>>;
  nextKey: MutableRefObject<number>;
  addShell: (dir: string | null, branch: string | null) => void;
  settings: Record<string, unknown>;
  screen: Screen;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setPage: Dispatch<SetStateAction<Page | null>>;
  owner: Record<string, string>;
  recentDirs: MutableRefObject<string[]>;
  activeRef: MutableRefObject<string | null>;
};

export function useWorkspaceActions({ panes, setPanes, setFocused, setActiveDir, setStacked, nextKey, addShell, settings, screen, setScreen, setPage, owner, recentDirs, activeRef }: ActionDeps) {
  // PROJ-033 / SESS-037: the setup script runs in a Setup terminal of the new workspace: a tab
  // beside its first pane, or a cell of its own to the right or below. `then` runs once it ends
  // (the agent waiting for setup), whatever its exit code, and lands as a tab beside it.
  const afterSetup = useRef<Record<number, () => void>>({});
  const startSetup = (dir: string, branch: string | null, line: SetupLine, where: SetupWhere, show: boolean, then?: () => Promise<number | null> | void) => {
    const key = nextKey.current++;
    setPanes((ps) => {
      const cells = cellsOf(panesIn(ps, dir));
      const tab = where === "tab" || cells.length >= MAX_PANES;
      if (!tab && where === "down" && cells.length === 1) setStacked((st) => ({ ...st, [dir]: true }));
      return [...ps, { key, cwd: dir, branch, agent: "shell", program: line.program, args: line.args, title: "Setup", word: line.program.split(/[\\/]/).pop()?.replace(/\.exe$/i, ""), group: tab ? cells[0]?.group : undefined }];
    });
    if (then)
      afterSetup.current[key] = () =>
        void Promise.resolve(then()).then((k) => {
          if (typeof k === "number") setPanes((ps) => ps.map((p) => (p.key === k ? { ...p, group: groupOf(ps.find((x) => x.key === key) ?? p) } : p)));
        });
    if (show) {
      setActiveDir(dir);
      setFocused(key);
    }
  };

  // PROJ-066: a click on a workspace row shows that workspace on the same click. Its panes were
  // kept while hidden, so they come back as they were; a workspace with no pane yet gets a shell.
  // TERM-005: `fresh` says the workspace was just made: its grid starts with the default pane
  // count, the shell counting as one and the rest empty. Only then, so nothing re-seeds later.
  const select = (dir: string, branch: string | null, fresh = false) => {
    setPage(null);
    recentDirs.current = [dir, ...recentDirs.current.filter((d) => !sameDir(d, dir))].slice(0, 20);
    setActiveDir(dir);
    if (screen === "artifacts") setScreen("terminals");
    if (panesIn(panes, dir).length > 0) setFocused((f) => focusIn(panes, dir, f));
    else {
      addShell(dir, branch);
      const more = fresh ? seedCount(settings[DEFAULT_PANES_FIELD], readLook(settings) === "classic") - 1 : 0;
      if (more > 0) setPanes((ps) => [...ps, ...Array.from({ length: more }, (): Pane => ({ key: nextKey.current++, cwd: dir, branch: null, agent: "shell", program: null, args: [], seats: [emptySeat()] }))]);
    }
  };

  // PROJ-066: removing a workspace closes every pane in it, wherever it was; the view stays
  // unless it was the one removed, then it falls back to the home group.
  // PROJ-070: the removed one gives way to the sibling used last that still has panes; the shown
  // workspace is read when the delete finishes, so a user who went elsewhere meanwhile stays there.
  // PROJ-053: putting workspaces to sleep closes their panes the same way, all at once.
  const removedAll = (paths: string[]) => {
    if (paths.length === 0) return;
    const left = paths.reduce((ps, d) => withoutDir(ps, d), panes);
    const gone = (d: string) => paths.some((x) => sameDir(d, x));
    const pid = projectOf(paths[0]);
    const siblings = Object.entries(owner).filter(([d, p]) => p === pid && !gone(d) && panesIn(left, d).length > 0).map(([d]) => d);
    const hit = paths.find((x) => activeRef.current !== null && activeAfterRemove(activeRef.current, x) !== activeRef.current);
    const next = hit === undefined ? activeRef.current : activeAfterRemove(activeRef.current, hit, recentDirs.current.filter((d) => !gone(d)), siblings);
    setPanes(left);
    setActiveDir(next);
    setFocused((f) => focusIn(left, next, f));
  };
  const removed = (path: string) => removedAll([path]);
  const projectOf = (cwd: string | null): string | null => (cwd ? (Object.entries(owner).find(([dir]) => sameDir(dir, cwd))?.[1] ?? null) : null);
  return { afterSetup, startSetup, select, removedAll, removed, projectOf };
}
