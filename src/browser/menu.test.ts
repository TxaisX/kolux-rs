import { describe, expect, it } from "vitest";
import { MENU_W, menuAt, menuColours, menuContext, menuEntries, menuHeight, menuSpec, placeMenu } from "./menu";

const can = { back: true, forward: false };
const colours = { bg: "#111", fg: "#eee", line: "#333", hover: "#444" };

describe("BROW-017 right-click menu", () => {
  it("a link gets the link entries, selected text gets Copy, the page itself gets Open Page", () => {
    const link = menuEntries({ link: "https://example.com/a", selection: false }, can, "https://host/");
    expect(link.map((i) => ("sep" in i ? "-" : i.id))).toEqual(["back", "forward", "-", "open-kolux", "open-default", "copy-link"]);
    expect(link.filter((i) => !("sep" in i) && i.url === "https://example.com/a")).toHaveLength(3);
    expect(link[1]).toMatchObject({ id: "forward", off: true });
    expect(link[0]).toMatchObject({ id: "back", off: false });
    const text = menuEntries({ link: "", selection: true }, can, "https://host/page");
    expect(text.map((i) => ("sep" in i ? "-" : i.id))).toEqual(["back", "forward", "-", "copy", "-", "open-default"]);
    expect(text[text.length - 1]).toMatchObject({ id: "open-default", label: "Open Page In Default Browser", url: "https://host/page", off: false });
    // a blank page has nothing to open externally
    const blank = menuEntries({ link: "", selection: false }, can, "about:blank");
    expect(blank[blank.length - 1]).toMatchObject({ off: true });
  });

  it("the menu opens at the pointer and flips to stay inside the pane near its edges", () => {
    const h = menuHeight(menuEntries({ link: "https://e.com/", selection: false }, can, ""));
    expect(h).toBe(8 + 5 * 26 + 9);
    // room on both sides: at the pointer
    expect(placeMenu({ x: 100, y: 80, vw: 900, vh: 700 }, MENU_W, h)).toEqual({ x: 100, y: 80 });
    // bottom-right corner: flipped left and up
    expect(placeMenu({ x: 880, y: 690, vw: 900, vh: 700 }, MENU_W, h)).toEqual({ x: 880 - MENU_W, y: 690 - h });
    // only the right edge is near: flipped left, not up
    expect(placeMenu({ x: 880, y: 10, vw: 900, vh: 700 }, MENU_W, h)).toEqual({ x: 660, y: 10 });
    // a pane too small for the menu: never off the top or left
    expect(placeMenu({ x: 5, y: 5, vw: 100, vh: 50 }, MENU_W, h)).toEqual({ x: 0, y: 0 });
  });

  it("the spec the page draws carries the placed corner, the width, the entries and the colours", () => {
    const e = { id: 3, kind: "menu" as const, x: "880", y: "690", vw: "900", vh: "700", s: "1", l: "https://e.com/x" };
    const spec = menuSpec(menuContext(e), can, "https://host/", menuAt(e), colours);
    expect(spec).toMatchObject({ bg: "#111", hover: "#444", w: MENU_W, x: 880 - MENU_W });
    expect(spec.y).toBeLessThan(690);
    expect(spec.items.map((i) => ("sep" in i ? "-" : i.id))).toEqual(["back", "forward", "-", "copy", "-", "open-kolux", "open-default", "copy-link"]);
    // a link that is not a web address (javascript:, mailto:) gets no link entries
    expect(menuContext({ id: 1, kind: "menu", l: "javascript:void(0)" }).link).toBe("");
    expect(menuAt({ id: 1, kind: "menu", x: "nan" })).toEqual({ x: 0, y: 0, vw: 0, vh: 0 });
    // no element to read the theme from: a plain dark menu
    expect(menuColours(null)).toEqual({ bg: "#1f1f1f", fg: "#e6e6e6", line: "#3a3a3a", hover: "#333333" });
  });
});
