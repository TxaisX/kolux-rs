// EDIT-031 (T-236-b): closing a new note that was never typed in removes the empty file Kolux made for it. The
// rule is closeGuard.unusedNotes; this runs it against the open buffers and sends the files to the trash (so
// even a wrong call is recoverable). App calls it with the tabs that are closing and the ones that stay.
import { invoke } from "@tauri-apps/api/core";
import { diskOf, textOf } from "./buffers";
import { unusedNotes, type GuardPane } from "./closeGuard";
import { isUntitled } from "./untitled";

export function trashUnusedNotes(closing: GuardPane[], staying: GuardPane[]): void {
  const paths = unusedNotes(closing, staying, isUntitled, (p) => ({ text: textOf(p), disk: diskOf(p) }));
  if (paths.length) void invoke("fs_trash", { paths }).catch(() => undefined);
}
