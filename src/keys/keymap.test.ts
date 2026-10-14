// The keymap: chord parsing, the built-in defaults per platform (SET-013), and how the file's
// overrides apply (SET-011, COMPAT.md 4.1 and 4.2).
import { expect, test } from "vitest";
import { actions } from "./actions";
import { chordMatches, chordsOf, labelOf, labelParts, matchEvent, parseChord, resolve, type KeyLike } from "./keymap";

const key = (k: Partial<KeyLike>): KeyLike => ({ key: "", code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...k });

test("the table registers the 129 carried commands (VIEW-053 added one, T-546 added view.tower); 53 ship unbound (T-543-b unbound Reopen closed tab) and 6 have only a macOS chord", () => {
  expect(actions.length).toBe(129);
  const ids = new Set(actions.map((a) => a.id));
  expect(ids.size).toBe(129);
  expect(ids.has("tab.newSimulator")).toBe(false);
  expect(ids.has("tab.openQuickCommandsMenu")).toBe(false);
  expect(actions.filter((a) => a.win32.length === 0 && !a.darwin).length).toBe(53);
  expect(actions.filter((a) => a.win32.length === 0 && a.darwin).map((a) => a.id).sort()).toEqual(["floatingWorkspace.maximize", "sidebar.ports.toggle", "tab.newAgent", "tab.rename", "workspace.rename"].sort());
  expect(actions.filter((a) => a.id.startsWith("tab.newAgent.")).length).toBe(35);
});

test("chords parse, normalise their spelling and refuse Mod mixed with Ctrl", () => {
  expect(parseChord("Mod+Shift+J")).toEqual({ mod: true, ctrl: false, meta: false, alt: false, shift: true, key: "J" });
  expect(parseChord("ctrl+shift+arrowup")).toEqual({ mod: false, ctrl: true, meta: false, alt: false, shift: true, key: "ArrowUp" });
  expect(parseChord("Mod+Shift+Plus")).toMatchObject({ key: "Plus" });
  expect(parseChord("Mod+Shift++")).toMatchObject({ key: "Plus" });
  expect(parseChord("F7")).toMatchObject({ key: "F7", mod: false });
  expect(parseChord("Mod+Ctrl+J")).toHaveProperty("error");
  expect(parseChord("Mod+Shift")).toHaveProperty("error");
  expect(parseChord("Super+J")).toHaveProperty("error");
  expect(parseChord("")).toHaveProperty("error");
});

test("fresh Windows profile: Ctrl+Shift+J opens the palette, Alt+1 selects tab 1, Ctrl+Shift+D splits right, Ctrl+J is next-needs-you", () => {
  const map = resolve(null, "win32");
  expect(map.errors).toEqual([]);
  expect(chordsOf(map, "worktree.palette")).toEqual(["Mod+Shift+J"]);
  expect(chordsOf(map, "terminals.focusNextNeedsYou")).toEqual(["Mod+J"]);
  expect(matchEvent(map, key({ key: "J", code: "KeyJ", ctrlKey: true, shiftKey: true }), ["global"])).toEqual({ id: "worktree.palette" });
  expect(matchEvent(map, key({ key: "j", code: "KeyJ", ctrlKey: true }), ["global"])).toEqual({ id: "terminals.focusNextNeedsYou" });
  expect(matchEvent(map, key({ key: "3", code: "Digit3", altKey: true }), ["tabs"])).toEqual({ id: "tab.selectByIndex", index: 3 });
  expect(matchEvent(map, key({ key: "D", code: "KeyD", ctrlKey: true, shiftKey: true }), ["terminal"])).toEqual({ id: "terminal.splitRight" });
  expect(matchEvent(map, key({ key: "D", code: "KeyD", altKey: true, shiftKey: true }), ["terminal"])).toEqual({ id: "terminal.splitDown" });
  expect(matchEvent(map, key({ key: "b", code: "KeyB", ctrlKey: true }), ["global"])).toEqual({ id: "sidebar.left.toggle" });
  // Scope: Mod+F finds in the browser, the editor, settings and the terminal, never globally.
  expect(matchEvent(map, key({ key: "f", code: "KeyF", ctrlKey: true }), ["global"])).toBeNull();
  expect(matchEvent(map, key({ key: "f", code: "KeyF", ctrlKey: true }), ["terminal"])).toEqual({ id: "terminal.search" });
  // The unassigned set from SET-013's second check.
  for (const id of ["workspace.openBoard", "dashboard.toggle", "view.tasks", "view.inbox", "view.floor"]) expect(chordsOf(map, id)).toEqual([]);
});

test("macOS differs where SET-013 says so, and Mod means Cmd there", () => {
  const map = resolve(null, "darwin");
  expect(chordsOf(map, "worktree.palette")).toEqual(["Mod+J"]);
  expect(chordsOf(map, "terminals.focusNextNeedsYou")).toEqual(["Mod+Shift+J"]);
  expect(chordsOf(map, "tab.selectByIndex")).toEqual(["Ctrl+1"]);
  expect(chordsOf(map, "terminal.splitRight")).toEqual(["Mod+D"]);
  expect(chordsOf(map, "workspace.rename")).toEqual(["Mod+Alt+R"]);
  expect(chordMatches("Mod+J", key({ key: "j", code: "KeyJ", metaKey: true }), "darwin")).toEqual({});
  expect(chordMatches("Mod+J", key({ key: "j", code: "KeyJ", ctrlKey: true }), "darwin")).toBeNull();
  expect(labelParts("Mod+Shift+J", "darwin")).toEqual(["Shift", "Cmd", "J"]);
});

test("labels read as the keys on the keyboard", () => {
  expect(labelParts("Mod+Shift+J", "win32")).toEqual(["Ctrl", "Shift", "J"]);
  expect(labelParts("Mod+Comma", "win32")).toEqual(["Ctrl", ","]);
  expect(labelParts("Mod+Shift+ArrowUp", "linux")).toEqual(["Ctrl", "Shift", "Up"]);
  expect(labelOf(resolve(null, "win32"), "view.tasks")).toEqual([]);
});

test("null unbinds, a win32 section beats the shared map, and the older top-level form still loads", () => {
  const map = resolve({ version: 1, keybindings: { "terminal.clear": null, "worktree.palette": "Mod+Shift+P", "zoom.in": ["Mod+Shift+Equal", "Mod+NumpadAdd"] }, platforms: { win32: { "worktree.palette": "Mod+Alt+P" }, darwin: { "terminal.clear": "Mod+L" } } }, "win32");
  expect(map.errors).toEqual([]);
  expect(chordsOf(map, "terminal.clear")).toEqual([]);
  expect(chordsOf(map, "worktree.palette")).toEqual(["Mod+Alt+P"]);
  expect(chordsOf(map, "zoom.in")).toEqual(["Mod+Shift+Equal", "Mod+NumpadAdd"]);
  expect(labelOf(map, "worktree.palette")).toEqual(["Ctrl", "Alt", "P"]);
  const mac = resolve({ keybindings: { "terminal.clear": null }, platforms: { darwin: { "terminal.clear": "Mod+L" } } }, "darwin");
  expect(chordsOf(mac, "terminal.clear")).toEqual(["Mod+L"]);
  const old = resolve({ "$schema": "x", version: 1, "sidebar.left.toggle": false, "terminals.focusNextNeedsYou": "Mod+Shift+Y" }, "win32");
  expect(old.errors).toEqual([]);
  expect(chordsOf(old, "sidebar.left.toggle")).toEqual([]);
  expect(chordsOf(old, "terminals.focusNextNeedsYou")).toEqual(["Mod+Shift+Y"]);
  // Index actions: a chord ending in another digit is rewritten to 1.
  expect(chordsOf(resolve({ keybindings: { "tab.selectByIndex": "Mod+Alt+4" } }, "win32"), "tab.selectByIndex")).toEqual(["Mod+Alt+1"]);
});

test("a bad chord, an unknown id or an unknown platform is reported for that entry only", () => {
  const map = resolve({ keybindings: { "terminal.clear": "Mod+Ctrl+K", "voice.dictation": "Mod+Shift+V", "tab.openQuickCommandsMenu": "Mod+Shift+P", "zoom.in": 7 }, platforms: { win64: { "zoom.out": null } } }, "win32");
  expect(chordsOf(map, "terminal.clear")).toEqual(["Mod+K"]);
  expect(chordsOf(map, "zoom.in")).toEqual(["Mod+Equal", "Mod+Shift+Plus", "Mod+NumpadAdd"]);
  expect(map.errors.length).toBe(2);
  expect(map.errors[0]).toContain("terminal.clear");
  expect(map.errors[1]).toContain("zoom.in");
  expect(map.warnings.length).toBe(3);
  expect(map.warnings.join(" ")).toContain("voice.dictation");
  expect(map.warnings.join(" ")).toContain("tab.openQuickCommandsMenu");
  expect(map.warnings.join(" ")).toContain("win64");
});

test("a file that is not an object keeps the defaults and says so", () => {
  const map = resolve([1, 2], "win32");
  expect(map.errors.length).toBe(1);
  expect(chordsOf(map, "worktree.palette")).toEqual(["Mod+Shift+J"]);
});

test("a custom chord that clashes inside its scope is dropped and the default stays; defaults may overlap", () => {
  const map = resolve({ keybindings: { "sidebar.right.toggle": "Mod+B" } }, "win32");
  expect(chordsOf(map, "sidebar.right.toggle")).toEqual(["Mod+L"]);
  expect(chordsOf(map, "sidebar.left.toggle")).toEqual(["Mod+B"]);
  expect(map.errors.length).toBe(1);
  expect(map.errors[0]).toContain("Toggle Right Sidebar");
  // Different scopes may share a chord (Mod+W closes a tab and a pane).
  const apart = resolve({ keybindings: { "terminal.closePane": "Mod+W" } }, "win32");
  expect(apart.errors).toEqual([]);
  // The conflict groups bite across scopes: tab.rename (tabs) and workspace.rename (global) share "workspace-shell".
  const grouped = resolve({ keybindings: { "tab.rename": "Mod+Alt+R", "workspace.rename": "Mod+Alt+R" } }, "win32");
  expect(chordsOf(grouped, "tab.rename")).toEqual([]);
  expect(grouped.errors[0]).toContain("Rename active tab");
});

test("SET-010: a clash names every command on the chord, scope by scope; agents switched off never count", () => {
  const map = resolve({ keybindings: { "view.tasks": "Mod+P" } }, "win32");
  expect(map.clashes).toEqual([{ chord: "Mod+P", ids: ["worktree.quickOpen", "view.tasks"] }]);
  expect(chordsOf(map, "view.tasks"), "the override is ignored").toEqual([]);
  expect(resolve({ keybindings: { "view.tasks": "Mod+K" } }, "win32").clashes, "terminal scope is apart").toEqual([]);
  expect(resolve({ keybindings: { "view.tasks": null } }, "win32").clashes, "no chord never clashes").toEqual([]);
  const agent = { keybindings: { "tab.newAgent.aider": "Mod+T" } };
  expect(resolve(agent, "win32").clashes[0].ids).toEqual(["tab.newTerminal", "tab.newAgent.aider"]);
  const off = resolve(agent, "win32", ["tab.newAgent.aider"]);
  expect([off.clashes, off.errors, chordsOf(off, "tab.newAgent.aider")]).toEqual([[], [], ["Mod+T"]]);
});
