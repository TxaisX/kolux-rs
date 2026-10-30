// T-611 (brief "Path to an A", Phase 0): every command is runnable and none does nothing. The palette's
// Commands section lists every action in actions.ts and runs each through the same code its shortcut
// runs; the commands that had no handler (the audit's five, plus Force Reload and Hard Reload, whose
// chords nothing in the window answered) now each do something, or are gone.
import { expect, test } from "vitest";
import { actions, actionById, sameAs } from "./actions";
import { matchEvent, resolve, type KeyLike } from "./keymap";
import { commandRows, windowCommand } from "./commands";
import { runCommand } from "./runCommand";
import { heldByTerminal } from "./terminalPolicy";

/** Every source file of the window, as text (tests left out). */
const SOURCES = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
/** Files that only list command ids (the table, the palette's rows, the menu's labels, the Shortcuts page's hidden set). */
const LISTS = new Set(["./actions.ts", "./commands.ts", "../chrome/chromeItems.ts", "../settings/shortcutRows.ts"]);
const named = (id: string) => Object.entries(SOURCES).some(([file, text]) => !LISTS.has(file) && text.includes(`"${id}"`));

/** What the window's key switch hands windowCommand (evidence/product-ux-App.patch). */
function spies() {
  const did: string[] = [];
  return { did, calls: { toggleRight: (tab: string) => void did.push(`right:${tab}`), renameWorkspace: () => void did.push("rename"), reload: () => void did.push("reload") } };
}

/** A command has a handler when the window's or a pane's key code names it, windowCommand runs it, it is
 *  another command under an old id (sameAs), or it is one of the per-agent new-tab commands App.tsx runs by prefix. */
function handled(id: string): boolean {
  if (sameAs[id]) return handled(sameAs[id]);
  if (windowCommand(id, spies().calls)) return true;
  if (id.startsWith("tab.newAgent.")) return SOURCES["../App.tsx"].includes(`hit.id.startsWith("tab.newAgent.")`);
  return named(id);
}

test("T-611: every action id in actions.ts has a handler", () => {
  expect(actions.filter((a) => !handled(a.id)).map((a) => a.id)).toEqual([]);
});

test("T-611: the five the audit found, Force Reload and Hard Reload each do something (or are gone)", () => {
  // An old id kept for keybindings files that name it runs another command's code.
  expect(sameAs["sidebar.sleepingWorkspaces.toggle"]).toBe("sidebar.sleeping.toggle"); // PROJ-053 / VIEW-053
  expect(sameAs["dashboard.toggle"]).toBe("view.tower"); // VIEW-029 / HID-020: the drawer's always-on successor (OD-09)
  expect(sameAs["browser.hardReload"]).toBe("browser.reload"); // BROW-005, as the same chord already does inside a page
  const { did, calls } = spies();
  for (const id of ["sidebar.checks.toggle", "workspace.rename", "app.forceReload"]) expect(windowCommand(id, calls), id).toBe(true);
  expect(did).toEqual(["right:checks", "rename", "reload"]);
  expect(windowCommand("view.tower", calls)).toBe(false); // the rest stay with the window's own switch
  // VIEW-079 (dropped): the Ports tab is cut, so its command is not registered: a file naming it gets the unknown-id warning.
  expect(actionById.has("sidebar.ports.toggle")).toBe(false);
  expect(resolve({ keybindings: { "sidebar.ports.toggle": "Mod+Shift+I" } }, "darwin").warnings.join(" ")).toMatch(/"sidebar\.ports\.toggle" .* is not a command Kolux knows/);
});

test("T-611: a chord bound to an old id runs the command it stands for", () => {
  const map = resolve({ keybindings: { "dashboard.toggle": "Mod+Alt+9", "sidebar.sleepingWorkspaces.toggle": "Mod+Alt+8" } }, "win32");
  const key = (k: string, code: string): KeyLike => ({ key: k, code, ctrlKey: true, altKey: true, shiftKey: false, metaKey: false });
  expect(matchEvent(map, key("9", "Digit9"), ["global"])).toEqual({ id: "view.tower" });
  expect(matchEvent(map, key("8", "Digit8"), ["global"])).toEqual({ id: "sidebar.sleeping.toggle" });
});

test("T-611: the palette's Commands section lists every command, the unbound ones included, with its keys when it has some", () => {
  const map = resolve(null, "win32");
  const ran: string[] = [];
  const all = actions.filter((a) => a.id.startsWith("tab.newAgent.")).map((a) => a.id.slice("tab.newAgent.".length));
  const rows = commandRows(map, all, (id, index) => void ran.push(index === undefined ? id : `${id}#${index}`));
  expect(new Set(rows.map((r) => r.section))).toEqual(new Set(["Commands"]));
  for (const r of rows) r.run();
  const ids = new Set(ran.map((x) => x.replace(/#\d$/, "")));
  expect(actions.filter((a) => !ids.has(a.id)).map((a) => a.id)).toEqual([]);
  // Each of the 56 unbound commands has its row; a bound one shows its keys.
  expect(actions.filter((a) => a.win32.length === 0 && !a.darwin).every((a) => ids.has(a.id))).toBe(true);
  expect(rows.find((r) => r.label === "Show Floor")).toMatchObject({ hint: undefined });
  expect(rows.find((r) => r.label === "Open Settings")).toMatchObject({ hint: "Ctrl+," });
  // The two 1 to 9 commands are nine rows each, each with its own digit.
  expect(rows.filter((r) => /^Select Tab \d$/.test(r.label)).map((r) => r.hint)).toEqual(["Alt+1", "Alt+2", "Alt+3", "Alt+4", "Alt+5", "Alt+6", "Alt+7", "Alt+8", "Alt+9"]);
  expect(ran).toContain("tab.selectByIndex#9");
  // TERM-041: a new-tab command per installed agent only; one that is not installed is not offered.
  ran.length = 0;
  for (const r of commandRows(map, ["claude"], (id) => void ran.push(id))) r.run();
  expect(ran.filter((id) => id.startsWith("tab.newAgent."))).toEqual(["tab.newAgent.claude"]);
});

test("T-611: a command picked in the palette runs the same code its shortcut runs, where the keyboard is", () => {
  const map = resolve(null, "win32");
  const target = new EventTarget();
  const heard: Array<string | null> = [];
  // Two key listeners as the window has them: one for the global scope, one for an editor's.
  target.addEventListener("keydown", (e) => heard.push(matchEvent(map, e as unknown as KeyLike, ["global"])?.id ?? null));
  target.addEventListener("keydown", (e) => heard.push(matchEvent(map, e as unknown as KeyLike, ["editor"])?.id ?? null));
  const now = { later: (f: () => void) => f(), target, event: () => new Event("keydown", { bubbles: true, cancelable: true }) };
  runCommand("view.floor", undefined, now); // unbound: no chord could ever have reached it
  expect(heard).toEqual(["view.floor", null]);
  heard.length = 0;
  runCommand("editor.find", undefined, now);
  expect(heard).toEqual([null, "editor.find"]);
  // The index commands carry their digit; a real key press afterwards is only a key press.
  heard.length = 0;
  let index: number | undefined;
  const t2 = new EventTarget();
  t2.addEventListener("keydown", (e) => void (index = matchEvent(map, e as unknown as KeyLike, ["tabs"])?.index));
  runCommand("tab.selectByIndex", 4, { ...now, target: t2 });
  expect(index).toBe(4);
  target.dispatchEvent(new Event("keydown"));
  expect(heard).toEqual([null, null]);
});

test("T-611: with Terminal first, a command picked in the palette is never left to the terminal program", () => {
  const settings = { terminalShortcuts: "terminal" };
  const xterm = { closest: (s: string) => (s === ".xterm" ? {} : null) } as unknown as Element;
  expect(heldByTerminal("view.floor", settings, xterm)).toBe(true); // a chord pressed in a terminal goes to its program
  const target = new EventTarget();
  let held: boolean | null = null;
  target.addEventListener("keydown", () => void (held = heldByTerminal("view.floor", settings, xterm)));
  runCommand("view.floor", undefined, { later: (f) => f(), target, event: () => new Event("keydown") });
  expect(held).toBe(false);
});
