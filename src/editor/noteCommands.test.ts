// GIT-040 / GIT-041 (T-034-b): the two note commands are in the command table and the Shortcuts
// list, Send Notes has no default key and a user's own chord for it is the one that fires.
import { expect, test } from "vitest";
import { actions } from "../keys/actions";
import { chordsOf, resolve, type KeyLike } from "../keys/keymap";
import { filterRows, shortcutRows } from "../settings/shortcutRows";
import { ADD_NOTE, NOTHING_TO_SEND, SEND_NOTES, noteCommand, noteCommandInfo, sendRoute } from "./noteCommands";

const press = (key: string, code: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test("GIT-040 / GIT-041: both commands are in the command list with their ids and titles", () => {
  const ids = actions.map((a) => a.id);
  expect(ids).toContain(ADD_NOTE);
  expect(ids).toContain(SEND_NOTES);
  expect(noteCommandInfo("add")).toMatchObject({ id: "editor.addReviewNote", title: "Add Review Note", scope: "editor" });
  expect(noteCommandInfo("send")).toMatchObject({ id: "sourceControl.sendReviewNotes", scope: "editor" });
});

test("GIT-040 / GIT-041: the keybindings list shows Add Review Note on Ctrl+Shift+A and Send Notes unbound", () => {
  const rows = shortcutRows(resolve(null, "win32"));
  const add = rows.find((r) => r.id === ADD_NOTE)!;
  const send = rows.find((r) => r.id === SEND_NOTES)!;
  expect(add).toMatchObject({ title: "Add Review Note", area: "Editor", labels: ["Ctrl+Shift+A"], badges: [] });
  expect(send).toMatchObject({ area: "Editor", labels: [], defaults: [], badges: ["Unassigned"] });
  // The page's search finds both by name.
  expect(filterRows(rows, "all", "review note").map((r) => r.id)).toEqual(expect.arrayContaining([ADD_NOTE, SEND_NOTES]));
  expect(filterRows(rows, "unassigned", "").map((r) => r.id)).toContain(SEND_NOTES);
  // macOS draws the same chord as Shift+Cmd+A.
  expect(shortcutRows(resolve(null, "darwin")).find((r) => r.id === ADD_NOTE)!.labels).toEqual(["Shift+Cmd+A"]);
});

test("GIT-041: Send Notes does nothing on a key press until the user binds one, then that chord sends", () => {
  const fresh = resolve(null, "win32");
  expect(chordsOf(fresh, SEND_NOTES)).toEqual([]);
  const chord = press("N", "KeyN", { ctrlKey: true, altKey: true });
  expect(noteCommand(fresh, chord)).toBeNull();
  const mine = resolve({ version: 1, keybindings: { [SEND_NOTES]: "Mod+Alt+N" } }, "win32");
  expect(mine.errors).toEqual([]);
  expect(chordsOf(mine, SEND_NOTES)).toEqual(["Mod+Alt+N"]);
  expect(noteCommand(mine, chord)).toBe("send");
  // Add Review Note keeps its default beside it, and a rebinding moves it.
  expect(noteCommand(mine, press("A", "KeyA", { ctrlKey: true, shiftKey: true }))).toBe("add");
  const moved = resolve({ version: 1, keybindings: { [ADD_NOTE]: "Mod+Alt+M" } }, "win32");
  expect(noteCommand(moved, press("A", "KeyA", { ctrlKey: true, shiftKey: true }))).toBeNull();
  expect(noteCommand(moved, press("M", "KeyM", { ctrlKey: true, altKey: true }))).toBe("add");
  // The modified row shows in the Shortcuts list.
  expect(shortcutRows(mine).find((r) => r.id === SEND_NOTES)).toMatchObject({ labels: ["Ctrl+Alt+N"], badges: ["Modified"] });
});

test("GIT-041: Send Notes opens the menu for Markdown notes, pastes line notes, and says so when there is nothing", () => {
  expect(sendRoute(true, 2, 0)).toBe("menu");
  expect(sendRoute(true, 2, 3)).toBe("menu");
  expect(sendRoute(true, 0, 3)).toBe("lines");
  expect(sendRoute(true, 0, 0)).toBe("none");
  expect(sendRoute(false, 2, 3)).toBe("none");
  expect(NOTHING_TO_SEND).toMatch(/no review notes/i);
});
