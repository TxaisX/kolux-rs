// T-610 (brief "Path to an A", Phase 0): no screen is unreachable. Every Screen id is reached from the top
// bar's switcher or from the palette (a command that shows it, or a row of its own), or it is not in the
// union; and the two Boards no longer share a name.
import { expect, test } from "vitest";
import { SCREEN_IDS, screens } from "./TopBar";
import { SCREEN_OF, screenRows } from "./reach";
import { actionById } from "../keys/actions";
import { commandRows } from "../keys/commands";
import { resolve } from "../keys/keymap";

/** Every way the palette shows a screen: its Commands rows (the commands SCREEN_OF names) and the screens' own rows. */
function palette(): Set<string> {
  const reached = new Set<string>();
  for (const r of commandRows(resolve(null, "win32"), [], (id) => SCREEN_OF[id] && reached.add(SCREEN_OF[id]))) r.run();
  for (const r of screenRows((s) => void reached.add(s))) r.run();
  return reached;
}

test("T-610: every Screen id is reachable from the switcher or the palette", () => {
  const switcher = new Set<string>(screens.map((s) => s.id));
  const fromPalette = palette();
  expect(SCREEN_IDS.filter((id) => !switcher.has(id) && !fromPalette.has(id))).toEqual([]);
});

test("T-610: Floor and Space are reached by their own commands, so the palette shows them; the switcher keeps VIEW-002's four", () => {
  expect(SCREEN_OF["view.floor"]).toBe("floor"); // VIEW-013, DT-08: from the palette, no sidebar item
  expect(SCREEN_OF["view.space"]).toBe("space"); // VIEW-014 / PROJ-083
  expect(screens.map((s) => s.id)).toEqual(["agents", "board", "terminals", "tower"]);
  // Each command SCREEN_OF names is a registered command (its row is in the palette's Commands section).
  for (const id of Object.keys(SCREEN_OF)) expect(actionById.has(id), id).toBe(true);
});

test("T-610: the workspace board is reached by its command and is no longer a second Board", () => {
  const title = actionById.get("workspace.openBoard")!.title; // the id stays (COMPAT 4.5, PROJ-085)
  expect(title).toBe("Show Workspace Statuses");
  expect(screens.find((s) => s.id === "board")!.label).toBe("Board"); // VIEW-001's Board keeps its name
  expect(title).not.toMatch(/board/i);
});
