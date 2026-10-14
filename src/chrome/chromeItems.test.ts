import { expect, test } from "vitest";
import { CHROME, chromeShown, windowSummary } from "./chromeItems";
import { describe, it } from "vitest";
import { MENU_SHORTCUT_IDS, menuBarState, menuScreen, menuSettingFlip, toAccelerator } from "./chromeItems";

test("SET-020: Tasks and Automations buttons show and the app name is hidden by default (DT-A6)", () => {
  expect(CHROME.map((c) => c.id)).toEqual(["titleBarAppName", "tasksButton", "automationsButton"]);
  expect(chromeShown({}, "tasksButton")).toBe(true);
  expect(chromeShown({}, "automationsButton")).toBe(true);
  expect(chromeShown({}, "titleBarAppName")).toBe(false);
  expect(chromeShown({ tasksButton: false, titleBarAppName: true }, "tasksButton")).toBe(false);
  expect(chromeShown({ titleBarAppName: true }, "titleBarAppName")).toBe(true);
  expect(chromeShown({ tasksButton: "no" }, "tasksButton")).toBe(true);
});

test("SET-016: the folded Window & Sidebar header sums up what shows", () => {
  expect(windowSummary({})).toBe("Tasks · Automations · Status bar");
  expect(windowSummary({ titleBarAppName: true, automationsButton: false, statusBarVisible: false })).toBe("App name · Tasks · Status bar hidden");
  expect(windowSummary({ tasksButton: false, automationsButton: false, statusBarHidden: ["memory"] })).toBe("Status bar, 3 of 4 items");
});

describe("T-248-a menu bar state (APP-009, SET-020, SET-009)", () => {
  it("spells keymap chords the way the menu does and drops keys the menu cannot name", () => {
    expect(toAccelerator("Mod+Comma")).toBe("CmdOrCtrl+Comma");
    expect(toAccelerator("Mod+Shift+R")).toBe("CmdOrCtrl+Shift+R");
    expect(toAccelerator("Mod+Equal")).toBe("CmdOrCtrl+Equal");
    expect(toAccelerator("Mod+0")).toBe("CmdOrCtrl+0");
    expect(toAccelerator("Cmd+Alt+F12")).toBe("Super+Alt+F12");
    expect(toAccelerator("Mod+Shift+Plus")).toBe("");
    expect(toAccelerator("Hyper+B")).toBe("");
    expect(toAccelerator(undefined)).toBe("");
  });

  it("ticks agree with each Settings switch, defaults included", () => {
    const chords: Record<string, string[]> = { "app.settings": ["Mod+Comma"], "zoom.in": ["Mod+Equal", "Mod+NumpadAdd"] };
    const st = menuBarState({ statusBarVisible: false, automationsButton: false }, "board", (id) => chords[id]);
    expect(st).toMatchObject({ screen: "board", statusBarVisible: false, tasksButton: true, automationsButton: false, titleBarAppName: false });
    expect(st.accelerators["app.settings"]).toBe("CmdOrCtrl+Comma");
    expect(st.accelerators["zoom.in"]).toBe("CmdOrCtrl+Equal");
    expect(st.accelerators["sidebar.left.toggle"]).toBe("");
    expect(Object.keys(st.accelerators)).toEqual([...MENU_SHORTCUT_IDS]);
  });

  it("a changed shortcut changes the state the menu is rebuilt from", () => {
    const a = menuBarState({}, "terminals", (id) => (id === "app.settings" ? ["Mod+Comma"] : undefined));
    const b = menuBarState({}, "terminals", (id) => (id === "app.settings" ? ["Mod+Shift+P"] : undefined));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(b.accelerators["app.settings"]).toBe("CmdOrCtrl+Shift+P");
  });

  it("a tick box flips its own field from what is shown now, and screens map back", () => {
    expect(menuSettingFlip({}, "set.statusBarVisible")).toEqual(["statusBarVisible", false]);
    expect(menuSettingFlip({ statusBarVisible: false }, "set.statusBarVisible")).toEqual(["statusBarVisible", true]);
    expect(menuSettingFlip({}, "set.titleBarAppName")).toEqual(["titleBarAppName", true]);
    expect(menuSettingFlip({ automationsButton: false }, "set.automationsButton")).toEqual(["automationsButton", true]);
    expect(menuSettingFlip({}, "app.settings")).toBeNull();
    expect(menuScreen("screen.board")).toBe("board");
    expect(menuScreen("screen.tower")).toBeNull();
  });
});
