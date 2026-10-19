// SET-008 / SET-010 (T-096-a): the Shortcuts page rows, filters, badges and search.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import ShortcutsPage from "./ShortcutsPage";
import { expect, test } from "vitest";
import { resolve } from "../keys/keymap";
import { filterRows, MAX_QUERY, shortcutRows } from "./shortcutRows";

const rows = (file: unknown = null) => shortcutRows(resolve(file, "win32"));
const ids = (r: ReturnType<typeof rows>) => r.map((x) => x.id);

test("every command is listed under its area with its chords and badges", () => {
  const all = rows({ keybindings: { "zoom.reset": "Mod+Alt+0", "zoom.in": null, "view.tasks": "Mod+P" } });
  expect(all.length).toBe(128); // 129 commands, Reopen closed tab hidden until T-164-b (T-543-b)
  expect(ids(all)).not.toContain("tab.reopenClosed");
  const by = (id: string) => all.find((r) => r.id === id)!;
  expect(by("terminal.clear")).toMatchObject({ area: "Terminal", labels: ["Ctrl+K"], badges: [] });
  expect(by("zoom.reset").badges).toEqual(["Modified"]);
  expect(by("zoom.in").badges).toEqual(["Disabled"]);
  expect(by("view.code").badges).toEqual([]);
  expect(by("workspace.openBoard").badges).toEqual(["Unassigned"]);
  expect(by("view.tasks").badges).toEqual(["Unassigned", "Conflicts"]);
  // Its override was dropped, but the file still holds it, so the row still offers Reset.
  expect([by("view.tasks").custom, by("worktree.quickOpen").custom]).toEqual([true, false]);
  expect(by("worktree.quickOpen").badges).toEqual(["Conflicts"]);
  expect(by("worktree.quickOpen").hint).toBe("Ctrl+P is also used by Open Tasks here. Give one of them other keys.");
});

test("filters: all, modified, unassigned, conflicting", () => {
  const all = rows({ keybindings: { "zoom.reset": "Mod+Alt+0", "zoom.in": null, "view.tasks": "Mod+P" } });
  expect(filterRows(all, "all", "").length).toBe(128);
  expect(ids(filterRows(all, "modified", ""))).toEqual(["zoom.in", "zoom.reset"]);
  expect(filterRows(all, "unassigned", "").every((r) => r.labels.length === 0)).toBe(true);
  expect(ids(filterRows(all, "unassigned", ""))).toContain("zoom.in");
  expect(ids(filterRows(all, "conflicting", ""))).toEqual(["worktree.quickOpen", "view.tasks"]);
});

test("search: titles, areas, ids and chords for every platform, as written or as drawn", () => {
  const all = rows();
  for (const q of ["Mod+K", "ctrl+k", "Ctrl + K"]) expect(ids(filterRows(all, "all", q)), q).toContain("terminal.clear");
  expect(ids(filterRows(all, "all", "clear active"))).toEqual(["terminal.clear"]);
  expect(ids(filterRows(all, "all", "fileExplorer.copyPath"))).toEqual(["fileExplorer.copyPath"]);
  expect(filterRows(all, "all", "file explorer").length).toBe(5);
  // macOS chords count: Cmd+D splits right there.
  expect(ids(filterRows(all, "all", "Cmd+D"))).toContain("terminal.splitRight");
  expect(ids(filterRows(all, "all", "cls"))).toEqual(["terminal.clear"]);
  // An enormous paste is cut to MAX_QUERY characters, not searched whole.
  expect(filterRows(all, "all", "k".repeat(MAX_QUERY * 50))).toEqual([]);
});

test("groups the commands by area under the four filters and a capped search box", () => {
  const html = renderToString(createElement(ShortcutsPage));
  for (const f of ["All", "Modified", "Unassigned", "Conflicting"]) expect(html).toContain(`>${f}</button>`);
  expect(html).toContain(`maxLength="${MAX_QUERY}"`);
  for (const area of ["General", "Terminal", "File explorer"]) expect(html).toContain(`<h3 class="keys-area">${area}</h3>`);
  expect(html).toContain('data-id="terminal.clear"');
});

test("SET-010 (T-248-b): a global command on a chord the macOS menu owns conflicts with that menu item", () => {
  const quit = [{ chord: "Mod+Q", name: "Quit Kolux" }];
  const mac = (file: unknown, native = quit) => shortcutRows(resolve(file, "darwin"), native);
  const by = (r: ReturnType<typeof rows>, id: string) => r.find((x) => x.id === id)!;
  // Nothing bound there by default: no clash, with or without the menu's chords.
  expect(mac(null).filter((r) => r.badges.includes("Conflicts"))).toEqual([]);
  const hit = by(mac({ keybindings: { "view.tasks": "Mod+Q" } }), "view.tasks");
  expect(hit.badges).toContain("Conflicts");
  expect(hit.hint).toBe("Cmd+Q is also used by Quit Kolux in the menu here. Give one of them other keys.");
  expect(ids(filterRows(mac({ keybindings: { "view.tasks": "Mod+Q" } }), "conflicting", ""))).toEqual(["view.tasks"]);
  // Another spelling of the same chord still counts; a smaller scope is not shadowed by the menu.
  expect(by(mac({ keybindings: { "view.tasks": "Cmd+Q" } }), "view.tasks").badges).toContain("Conflicts");
  expect(by(mac({ keybindings: { "terminal.clear": "Mod+Q" } }), "terminal.clear").badges).not.toContain("Conflicts");
  // Windows and Linux report no native chords, so nothing changes there.
  expect(by(shortcutRows(resolve({ keybindings: { "view.tasks": "Mod+Q" } }, "win32"), []), "view.tasks").badges).not.toContain("Conflicts");
  // Two commands on the menu's chord clash with each other first (the keymap drops both), as before.
  expect(by(mac({ keybindings: { "view.tasks": "Mod+Q", "view.code": "Mod+Q" } }), "view.tasks").hint).toContain("is also used by Show Code here");
});
