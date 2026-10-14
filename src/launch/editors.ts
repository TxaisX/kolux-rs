// SESS-039: the outside editors a worktree can be opened in (VS Code, Cursor, Zed, Sublime Text,
// NeoVim, the JetBrains IDEs). The Rust side finds them (tools.rs) and starts one on a folder
// (links.rs, fenced to the registered roots); this side lists them and asks for the open.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export type Editor = { id: string; name: string; path: string; console: boolean };

/** The row label for opening the worktree in `e`. */
export function openLabel(e: Editor): string {
  return `Open in ${e.name}`;
}

/** The row tooltip: where the editor lives and what it will open. NeoVim says it gets a console window. */
export function openTitle(e: Editor, dir: string): string {
  return `Open ${dir} in ${e.name}${e.console ? " in a console window" : ""} (${e.path})`;
}

/** Asks the Rust side to open `dir` in the editor `id`; resolves to the editor's name. */
export function openIn(id: string, dir: string): Promise<string> {
  return invoke<string>("editor_open", { editor: id, dir });
}

/** The installed editors, looked up once when `on` turns true; empty until the answer comes (or if it fails). */
export function useEditors(on: boolean): Editor[] {
  const [list, setList] = useState<Editor[]>([]);
  useEffect(() => {
    if (!on) return;
    let live = true;
    invoke<Editor[]>("editors_list").then(
      (l) => live && setList(l),
      () => live && setList([]),
    );
    return () => {
      live = false;
    };
  }, [on]);
  return list;
}
