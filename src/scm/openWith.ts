// GIT-014 (T-313-b): the apps a changed file can be opened in, from General settings' Open in list.
// The list is edited from the same menu with the same rules as the settings page (settings/openIn.ts).
// The file manager is not an app here: the menu has its own Show in file manager item.
import { invoke } from "@tauri-apps/api/core";
import { OPEN_IN_FIELD, readOpenIn, type OpenInApp } from "../settings/openIn";

export type FileApp = { id: string; label: string; command: string };

/** One menu item per listed app, in the user's order. */
export const fileApps = (settings: Record<string, unknown> | null): FileApp[] =>
  readOpenIn(settings ?? {})
    .filter((a) => a.id !== "explorer")
    .map((a) => ({ id: a.id, label: `Open in ${a.name}`, command: a.command }));

/** The settings patch that stores an edited list. */
export const listPatch = (list: OpenInApp[]): Record<string, unknown> => ({ [OPEN_IN_FIELD]: list });

/** Opens `path` (relative to `worktree`) in `command`; rejects with the reason a launch failed. */
export const openFileWith = (worktree: string, path: string, command: string): Promise<void> => invoke<void>("scm_open_with", { worktree, path, command });
