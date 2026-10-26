// EDIT-036 box 1 (Mod+P, type panel: name hits first) and box 2 (hover: the path tooltip follows the pointer),
// with the REAL FilePicker component run with no DOM and the REAL key map.
// MIRROR src/App.tsx:869-871 (worktree.quickOpen -> setPicking("file") -> <FilePicker load=quickOpenList(file_list)>).
import { describe, expect, it, vi } from "vitest";
import FilePicker, { type Listing } from "../FilePicker";
import { defaultsOnly, matchEvent, type KeyLike } from "../../keys/keymap";
import { find, findAll, mount, textOf, type El } from "../../settings/__cards__/shallow-react";

vi.mock("react", async (orig) => {
  const patched = (await import("../../settings/__cards__/shallow-react")).patchReact(await orig<object>());
  const useMemo = <T>(f: () => T) => f();
  return { ...patched, useMemo, default: { ...(patched as { default: object }).default, useMemo } };
});

const ROOT = "C:/w/app";
const rels = ["src/panel/index.ts", "src/panel/util.ts", "docs/sidepanel.md", "src/panel.tsx", "readme.md"];
const listing: Listing = { items: rels.map((r) => ({ path: `${ROOT}/${r}` })), capped: false };
const ev = (o: Partial<KeyLike>): KeyLike => ({ key: "", code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o });
// hook order in FilePicker: 0 list, 1 error, 2 tries, 3 filter, 4 at, 5 tip
const open = () => {
  const m = mount(FilePicker, { root: ROOT, what: "file", load: () => new Promise(() => {}), onPick: () => {}, onClose: () => {} }, { 0: listing });
  return { m, tree: m.render() };
};
const options = (tree: El) => findAll(tree, (e) => e.props.role === "option").map((e) => e.props["aria-label"] as string);

describe("EDIT-036 box 1: type panel after Mod+P", () => {
  it("Mod+P is the Quick Open action", () => {
    expect(matchEvent(defaultsOnly("win32"), ev({ key: "p", code: "KeyP", ctrlKey: true }), ["global"])).toEqual({ id: "worktree.quickOpen" });
  });
  it("files with panel in their name are listed before files that only sit in a panel folder", () => {
    const { m, tree } = open();
    expect(options(tree)).toEqual(rels); // empty query: list order
    find(tree, (e) => e.type === "input").props.onChange({ target: { value: "panel" } });
    const shown = options(m.render());
    expect(shown).toEqual(["src/panel.tsx", "docs/sidepanel.md", "src/panel/util.ts", "src/panel/index.ts"]);
    const lastNameHit = Math.max(shown.indexOf("src/panel.tsx"), shown.indexOf("docs/sidepanel.md"));
    const firstFolderOnly = Math.min(shown.indexOf("src/panel/util.ts"), shown.indexOf("src/panel/index.ts"));
    expect(lastNameHit).toBeLessThan(firstFolderOnly);
    expect(shown).not.toContain("readme.md");
  });
});

describe("EDIT-036 box 2: hover a result", () => {
  it("no tooltip until the pointer is over a result; then it shows the full path, name set apart, and follows the pointer", () => {
    vi.stubGlobal("innerWidth", 1000);
    const { m, tree } = open();
    expect(findAll(tree, (e) => e.props.role === "tooltip")).toHaveLength(0);
    const row = findAll(tree, (e) => e.props.role === "option")[3]; // src/panel.tsx
    row.props.onMouseMove({ clientX: 100, clientY: 50 });
    let tip = find(m.render(), (e) => e.props.role === "tooltip");
    expect(tip.props.style).toEqual({ left: 114, top: 68 });
    expect(textOf(tip)).toBe("C:/w/app/src/" + "panel.tsx");
    const parts = (tip.props.children as El[]).filter(Boolean);
    expect(parts.map((p) => [p.type, textOf(p)])).toEqual([["span", "C:/w/app/src/"], ["strong", "panel.tsx"]]);
    row.props.onMouseMove({ clientX: 240, clientY: 90 }); // the pointer moves on the same result
    tip = find(m.render(), (e) => e.props.role === "tooltip");
    expect(tip.props.style).toEqual({ left: 254, top: 108 });
    row.props.onMouseMove({ clientX: 800, clientY: 90 }); // near the right edge it flips to the pointer's left
    tip = find(m.render(), (e) => e.props.role === "tooltip");
    expect(tip.props.style).toEqual({ right: 206, top: 108 });
    find(m.render(), (e) => e.props.role === "listbox").props.onMouseLeave(); // leaving the list hides it
    expect(findAll(m.render(), (e) => e.props.role === "tooltip")).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
