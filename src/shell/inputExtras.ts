// TERM-066 / TERM-053 / TERM-062: small pure rules the terminal and the floating panel share. Copy on select with one failure
// notice per drag, tab search by name only with late answers dropped, and the floating panel's tab commands (rename included).
import { route, type Op } from "../floating/panel";
import { windowTaps } from "../keys/tapHit";

export const COPY_FAILED = "Copy on select could not reach the clipboard";

/**
 * TERM-066: the handler for a terminal's selection changes. Each change copies the selected text; a drag fires many of them, so a
 * failing clipboard says so once, then stays quiet until the selection has been cleared (the next drag starts from nothing).
 */
export function copyOnSelect(write: (text: string) => Promise<void> | undefined, say: (text: string) => void): (selected: string) => void {
  let told = false;
  return (selected) => {
    if (!selected) {
      told = false;
      return;
    }
    const fail = () => {
      if (told) return;
      told = true;
      say(COPY_FAILED);
    };
    try {
      void write(selected)?.catch(fail);
    } catch {
      fail();
    }
  };
}

/** TERM-053: the open tabs whose own name contains the query. The worktree a tab lives in is not part of the name; nothing typed finds nothing. */
export function searchTabs<T extends { name: string }>(query: string, tabs: T[]): T[] {
  const q = query.trim().toLowerCase();
  return q ? tabs.filter((t) => t.name.toLowerCase().includes(q)) : [];
}

/** TERM-053: ask for a ticket before each search; only the newest ticket is current, so an answer that arrives late is dropped. */
export function latestOnly() {
  let n = 0;
  return { next: (): number => ++n, isCurrent: (ticket: number): boolean => ticket === n };
}

export type FloatOp = Op | { op: "rename" };

/**
 * TERM-062: route() plus Rename. Inside the open panel the rename command renames the panel's tab, never a tab of the window;
 * outside the panel it is left to the window. Everything else is route()'s answer, so a chord the panel has no action for stays null.
 */
export function routeFloating(id: string, index: number | undefined, open: boolean, inPanel: boolean): FloatOp | null {
  if (id === "tab.rename") return open && inPanel ? { op: "rename" } : null;
  return route(id, index, open, inPanel);
}

/** TERM-062: a double-tap shortcut must not complete across a lost focus. Returns the undo. */
export function installTapReset(target: Pick<Window, "addEventListener" | "removeEventListener"> = window): () => void {
  const lost = () => windowTaps.reset();
  target.addEventListener("blur", lost);
  return () => target.removeEventListener("blur", lost);
}
