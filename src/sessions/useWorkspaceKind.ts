// VIEW-057 (T-146-g): whether the workspace in front is a folder workspace, and the worktrees of its
// project (the Attached worktrees tab lists the ones attached to it). The window asks again when its
// workspace list changes (`refreshKey`); an answer for a workspace the window has left is dropped.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Worktree } from "../projects/model";
import { isFolderWorkspace } from "./folderTabs";

export type WorkspaceKind = { folder: boolean; worktrees: Worktree[] };
const NONE: WorkspaceKind = { folder: false, worktrees: [] };

export function useWorkspaceKind(projectId: string | null, dir: string | null, refreshKey: number): WorkspaceKind {
  const [kind, setKind] = useState<WorkspaceKind>(NONE);
  useEffect(() => {
    if (projectId === null || dir === null) {
      setKind(NONE);
      return;
    }
    let gone = false;
    invoke<Worktree[]>("workspace_list", { projectId }).then(
      (worktrees) => !gone && setKind({ folder: isFolderWorkspace(dir, worktrees), worktrees }),
      () => !gone && setKind(NONE),
    );
    return () => {
      gone = true;
    };
  }, [projectId, dir, refreshKey]);
  return kind;
}
