// TERM-094 (with VIEW-105, built here by DT-39): the link action menu, and the one decision of what a press on a
// link does. It works together with the first-click question (TERM-135, src/shell/linkAsk.ts) instead of replacing it:
//  - a plain link click (the link modifier, no Shift or Alt) asks where web links open until that was answered,
//    then opens there with no question;
//  - Shift or Alt with the modifier names a destination and opens at once (TERM-092 / TERM-135);
//  - the link modifier with the secondary button (Ctrl+right-click, Cmd+right-click on macOS) opens the link
//    menu: the full destination, open in either browser, copy the link (the menu stays open), and the way to
//    the link settings. A pick from the menu names its destination, so it opens at once without the question
//    and saves nothing. Coordinator default (the cards leave the gesture open): right-click alone keeps the pane
//    menu and right-click paste (TERM-035 / TERM-072), so the menu takes the modifier with it.
// Everything here is pure; TerminalPane wires it and LinkActionMenu.tsx draws the menu.
import { needsAsk, type LinkState } from "../shell/linkAsk";
import { clickTarget, resolvePath, type Found } from "./links";

/** The saved setting: the menu is on unless switched off (off also drops it from the hover hint). */
export const LINK_MENU_FIELD = "terminalLinkMenu";
export const linkMenuOn = (s: Record<string, unknown> | null | undefined): boolean => s?.[LINK_MENU_FIELD] !== false;

export type LinkPress = { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey?: boolean };

/** The menu gesture: the secondary button with the link modifier (Cmd on macOS, Ctrl elsewhere), menu on. */
export const opensMenu = (e: LinkPress, mac: boolean, menuOn: boolean): boolean => menuOn && e.button === 2 && (mac ? e.metaKey : e.ctrlKey);

export type Door = "kolux" | "system" | "file";
export type ClickPlan = { kind: "menu" } | { kind: "ask" } | { kind: "open"; door: Door } | null;

/** What a press on a link does. `inKolux` is the saved link destination with a Kolux browser wired to it, as
 *  clickTarget reads it; `state` is the first-click question's state. Null: not a link press (no modifier, the
 *  middle button, or the secondary button with the menu off), so the press keeps its usual meaning. */
export function planClick(f: Found, e: LinkPress, mac: boolean, inKolux: boolean, state: LinkState, menuOn: boolean): ClickPlan {
  if (opensMenu(e, mac, menuOn)) return { kind: "menu" };
  if (e.button !== 0) return null;
  const door = clickTarget(f, e, mac, inKolux);
  if (door === null) return null;
  // TERM-135: only a web click that names no destination asks, and only until it was answered.
  if (f.kind === "url" && needsAsk(state, e.shiftKey || !!e.altKey)) return { kind: "ask" };
  return { kind: "open", door };
}

export type LinkItemId = "open-kolux" | "open-system" | "open-file" | "copy" | "settings";
export type LinkItem = { id: LinkItemId; name: string };

/** The menu's rows. A web link: open where links go now first, the other place second (only when a Kolux browser
 *  is wired), copy, link settings. A file: open, copy the path, link settings. */
export function linkMenuItems(f: Found, inKolux: boolean, koluxWired: boolean, editor: boolean): LinkItem[] {
  const tail: LinkItem[] = [
    { id: "copy", name: f.kind === "url" ? "Copy link" : "Copy path" },
    { id: "settings", name: "Link settings" },
  ];
  if (f.kind === "file") return [{ id: "open-file", name: editor ? "Open in the editor" : "Open with its app" }, ...tail];
  const kolux: LinkItem = { id: "open-kolux", name: "Open in the Kolux browser" };
  const system: LinkItem = { id: "open-system", name: "Open in the system browser" };
  const opens = !koluxWired ? [system] : inKolux ? [kolux, system] : [system, kolux];
  return [...opens, ...tail];
}

/** The menu's heading: the full destination (a file resolved against the pane's folder, with its line). */
export function destinationOf(f: Found, cwd: string | null): string {
  if (f.kind === "url") return f.target;
  const path = resolvePath(f.target, cwd) ?? f.target;
  return f.line !== undefined ? `${path}:${f.line}${f.column !== undefined ? `:${f.column}` : ""}` : path;
}

/** What Copy puts on the clipboard: the link as written, or the resolved path. */
export const copyTextOf = (f: Found, cwd: string | null): string => (f.kind === "url" ? f.target : (resolvePath(f.target, cwd) ?? f.target));

/** The door a menu pick opens, or null for the rows that open nothing (copy, settings). */
export const doorOfItem = (id: LinkItemId): Door | null => (id === "open-kolux" ? "kolux" : id === "open-system" ? "system" : id === "open-file" ? "file" : null);

/** The note a failed open leaves (VIEW-105: a failed open says so). */
export const openFailed = (target: string, why: string): string => `${target} could not be opened (${why})`;
