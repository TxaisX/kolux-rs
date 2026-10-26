import { describe, expect, it } from "vitest";
import { deletePlan, descendants, fileManagerName, rowMenu, type MenuFor } from "./menu";

const base: MenuFor = { count: 1, isMain: false, asleep: false, deleting: false, platform: "Win32", alt: false, statuses: [{ id: "todo", label: "To do" }], editors: [{ label: "VS Code", command: "code" }] };
const ids = (o: Partial<MenuFor>) => rowMenu({ ...base, ...o }).map((i) => i.id);
const W = (path: string, parent?: string) => ({ path, parent });

describe("PROJ-065 workspace context menu", () => {
  it("lists Delete, Sleep, Move to status, Set parent, Details and Open in for one row", () => {
    expect(ids({})).toEqual(["delete", "sleep", "status", "parent", "details", "open-in"]);
    expect(rowMenu(base).find((i) => i.id === "status")?.children?.map((c) => c.id)).toEqual(["status:todo", "statuses:edit"]);
  });
  it("a sleeping workspace offers Wake; the main checkout is never deleted or slept", () => {
    expect(ids({ asleep: true })).toContain("wake");
    expect(ids({ isMain: true })).toEqual(["status", "details", "open-in"]);
  });
  it("the file manager is named for the platform and Open in has the editors and a terminal", () => {
    expect(fileManagerName("MacIntel")).toBe("Finder");
    expect(fileManagerName("Win32")).toBe("Explorer");
    expect(fileManagerName("Linux x86_64")).toBe("Files");
    expect(rowMenu(base).find((i) => i.id === "open-in")?.children?.map((c) => c.label)).toEqual(["Explorer", "VS Code", "Terminal"]);
  });
  it("Open in is disabled while the workspace is being deleted", () => {
    expect(rowMenu({ ...base, deleting: true }).find((i) => i.id === "open-in")?.disabled).toBe(true);
  });
  it("the developer submenu needs Alt and a single row", () => {
    expect(ids({})).not.toContain("developer");
    expect(ids({ alt: true })).toContain("developer");
    expect(ids({ alt: true, count: 3 })).not.toContain("developer");
  });
  it("several rows get Delete N and no per-row items", () => {
    expect(rowMenu({ ...base, count: 3 }).map((i) => i.label)).toEqual(["Delete 3 workspaces", "Sleep", "Move to status"]);
  });
});

describe("T-055 deleting a workspace with children", () => {
  const all = [W("C:/ws/a"), W("C:/ws/b", "C:/ws/a"), W("C:/ws/c", "C:/ws/b"), W("C:/ws/d")];
  it("finds children at every depth", () => {
    expect(descendants("C:/ws/a", all)).toEqual(["C:/ws/b", "C:/ws/c"]);
    expect(descendants("C:/WS/A/", all)).toEqual(["C:/ws/b", "C:/ws/c"]);
  });
  it("deletes children first and the parent last, and always asks", () => {
    const p = deletePlan(["C:/ws/a"], all, false);
    expect(p.order).toEqual(["C:/ws/c", "C:/ws/b", "C:/ws/a"]);
    expect(p.withChildren).toBe(true);
    expect(p.mustAsk).toBe(true);
  });
  it("a lone childless workspace follows the question setting; a batch always asks", () => {
    expect(deletePlan(["C:/ws/d"], all, false)).toEqual({ order: ["C:/ws/d"], withChildren: false, mustAsk: false });
    expect(deletePlan(["C:/ws/d"], all, true).mustAsk).toBe(true);
    expect(deletePlan(["C:/ws/d", "C:/ws/c"], all, false).mustAsk).toBe(true);
  });
  it("a loop in the records does not hang", () => {
    expect(deletePlan(["x"], [W("x", "y"), W("y", "x")], false).order.sort()).toEqual(["x", "y"]);
  });
});
