// TERM-094 / VIEW-105 with TERM-135: what a press on a link does, the menu's rows, and the menu setting.
import { describe, expect, it } from "vitest";
import { findLinks, hintFor } from "./links";
import { copyTextOf, destinationOf, doorOfItem, linkMenuItems, linkMenuOn, LINK_MENU_FIELD, openFailed, opensMenu, planClick } from "./linkMenu";
import { readText } from "./text";

const url = findLinks("see https://example.com/a?b=1 now")[0];
const file = findLinks("src/a.ts:3")[0];
const fresh = { inKolux: false, asked: false };
const answered = { inKolux: false, asked: true };
const press = (o: Partial<{ button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });

describe("planClick: a plain link click asks first, then opens where chosen", () => {
  it("fresh profile: Ctrl+click on a web link asks (TERM-135), the menu does not replace the question", () => {
    expect(planClick(url, press({ ctrlKey: true }), false, false, fresh, true)).toEqual({ kind: "ask" });
  });
  it("after the answer the same click opens at the saved place with no question", () => {
    expect(planClick(url, press({ ctrlKey: true }), false, false, answered, true)).toEqual({ kind: "open", door: "system" });
    expect(planClick(url, press({ ctrlKey: true }), false, true, { inKolux: true, asked: true }, true)).toEqual({ kind: "open", door: "kolux" });
  });
  it("Shift or Alt with the modifier names a destination and never asks", () => {
    expect(planClick(url, press({ ctrlKey: true, shiftKey: true }), false, true, fresh, true)).toEqual({ kind: "open", door: "system" });
    expect(planClick(url, press({ ctrlKey: true, altKey: true }), false, false, fresh, true)).toEqual({ kind: "open", door: "system" });
  });
  it("a file link never asks: the question is about web links only", () => {
    expect(planClick(file, press({ ctrlKey: true }), false, false, fresh, true)).toEqual({ kind: "open", door: "file" });
  });
  it("no modifier, or the middle button, is not a link press", () => {
    expect(planClick(url, press(), false, false, answered, true)).toBeNull();
    expect(planClick(url, press({ button: 1, ctrlKey: true }), false, false, answered, true)).toBeNull();
  });
  it("the link modifier with right-click opens the menu, even before the question was answered", () => {
    expect(planClick(url, press({ button: 2, ctrlKey: true }), false, false, fresh, true)).toEqual({ kind: "menu" });
    expect(planClick(url, press({ button: 2, metaKey: true }), true, false, answered, true)).toEqual({ kind: "menu" });
  });
  it("macOS: Ctrl is not the link modifier, so Ctrl+right-click is not the menu", () => {
    expect(planClick(url, press({ button: 2, ctrlKey: true }), true, false, answered, true)).toBeNull();
  });
  it("menu off: the gesture does nothing to the link (the right-click keeps its usual meaning)", () => {
    expect(planClick(url, press({ button: 2, ctrlKey: true }), false, false, answered, false)).toBeNull();
    expect(opensMenu(press({ button: 2, ctrlKey: true }), false, false)).toBe(false);
  });
  it("right-click alone is never the menu (the pane menu and right-click paste keep it)", () => {
    expect(opensMenu(press({ button: 2 }), false, true)).toBe(false);
  });
});

describe("linkMenuItems: open, open in the other place, copy, link settings", () => {
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
  it("links set to the system browser: system first, the Kolux browser second", () => {
    expect(ids(linkMenuItems(url, false, true, true))).toEqual(["open-system", "open-kolux", "copy", "settings"]);
  });
  it("links set to the Kolux browser: Kolux first, the system browser second", () => {
    expect(ids(linkMenuItems(url, true, true, true))).toEqual(["open-kolux", "open-system", "copy", "settings"]);
  });
  it("no Kolux browser wired: only the system browser is offered", () => {
    expect(ids(linkMenuItems(url, true, false, true))).toEqual(["open-system", "copy", "settings"]);
  });
  it("a file link: open, copy the path, link settings", () => {
    const items = linkMenuItems(file, false, true, true);
    expect(ids(items)).toEqual(["open-file", "copy", "settings"]);
    expect(items[0].name).toBe("Open in the editor");
    expect(items[1].name).toBe("Copy path");
    expect(linkMenuItems(file, false, true, false)[0].name).toBe("Open with its app");
  });
  it("each open row names its door, so a pick opens at once without the question", () => {
    expect(doorOfItem("open-kolux")).toBe("kolux");
    expect(doorOfItem("open-system")).toBe("system");
    expect(doorOfItem("open-file")).toBe("file");
    expect(doorOfItem("copy")).toBeNull();
    expect(doorOfItem("settings")).toBeNull();
  });
});

describe("the menu's heading and copy text (VIEW-105: the full destination)", () => {
  it("a web link shows and copies the whole address, query included", () => {
    expect(destinationOf(url, "C:\\w")).toBe("https://example.com/a?b=1");
    expect(copyTextOf(url, "C:\\w")).toBe("https://example.com/a?b=1");
  });
  it("a relative file is resolved against the pane's folder, with its line in the heading", () => {
    expect(destinationOf(file, "C:\\w")).toBe("C:\\w\\src\\a.ts:3");
    expect(copyTextOf(file, "C:\\w")).toBe("C:\\w\\src\\a.ts");
  });
  it("with no folder the path is shown as printed", () => {
    expect(destinationOf(file, null)).toBe("src/a.ts:3");
  });
  it("a failed open names the link and the reason", () => {
    expect(openFailed("https://x.y", "no browser")).toBe("https://x.y could not be opened (no browser)");
  });
});

describe("the menu setting and the hover hint", () => {
  it("on by default; only an explicit false turns it off", () => {
    expect(linkMenuOn({})).toBe(true);
    expect(linkMenuOn(null)).toBe(true);
    expect(linkMenuOn({ [LINK_MENU_FIELD]: false })).toBe(false);
    expect(readText({}).linkMenu).toBe(true);
    expect(readText({ [LINK_MENU_FIELD]: false }).linkMenu).toBe(false);
  });
  it("menu on: the hint names the gesture; off: the hint does not mention it", () => {
    expect(hintFor(url, false, "browser", true)).toBe("Ctrl+click to open https://example.com/a?b=1 in your browser · Ctrl+right-click for more");
    expect(hintFor(url, true, "kolux", true)).toBe("Cmd+click to open https://example.com/a?b=1 in Kolux · Cmd+right-click for more");
    expect(hintFor(url, false, "browser", false)).not.toMatch(/right-click|more/);
  });
});
