// GIT-041 (T-034-b): review notes in a folder workspace without Git. There is no diff to hang a
// note on there, so a note is made on the lines selected in a file's editor and kept like any other
// line note: per workspace folder (diffNotes.ts keys the book by the folder alone, never by a
// repository), listed in Source Control's notes section, sent to the folder's agent as the same
// short blocks. Opening one lands on the line in the file, not in a diff.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { editedText, type LineNote } from "./diffNotes";
import type { Note } from "./notes";

/** True when git's refusal means the folder is not a repository (git's own wording, or ours). */
export const repolessError = (message: string) => /not a git repository|not inside a git repository/i.test(message);

/** The lines a selection covers: `line` is where it starts; a quote of three lines ends two later. */
export const lastLineOf = (line: number, quote: string) => line + Math.max(0, quote.replace(/\s+$/, "").split("\n").length - 1);

/** A line note made from a selection in a file's editor; null when the note text is empty. */
export function plainNote(n: Pick<Note, "path" | "line" | "quote" | "note">, id: string): LineNote | null {
  const text = editedText(n.note);
  if (text === null) return null;
  const end = lastLineOf(n.line, n.quote);
  return { id, path: n.path, line: n.line, ...(end > n.line ? { end } : {}), text, staged: false };
}

/** Where a note opens from Source Control: the file at its line without Git, the diff otherwise. */
export const noteTarget = (repoless: boolean): "file" | "diff" => (repoless ? "file" : "diff");

/** The hint under an empty notes section. */
export const emptyNotesHint = (repoless: boolean, chord: string) =>
  repoless
    ? `No review notes yet. In a file, select some lines and press ${chord || "the Add Review Note key"}.`
    : `No review notes yet. In a diff, hover a line and click the plus, or select lines and press ${chord || "the Add Review Note key"}.`;

/** Whether this workspace's folder is outside any Git repository, asked again whenever the folder
 * changes. False while it is not known, so a note made in that moment follows the usual route. */
export function useRepoless(dir: string | null): boolean {
  const [repoless, set] = useState(false);
  useEffect(() => {
    set(false);
    if (dir === null) return;
    let alive = true;
    invoke("scm_status", { worktree: dir }).then(
      () => alive && set(false),
      (err) => alive && set(repolessError(String(err))),
    );
    return () => {
      alive = false;
    };
  }, [dir]);
  return repoless;
}
