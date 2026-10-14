import { describe, expect, it } from "vitest";
import { cellEditable, groupItems, labelChange, openingView, parseProjectRef, type ProjectField, type ProjectItem, pushRecent, refsFrom, scopeItems, sortItems, togglePin, viewLabel, viewSupport, viewUrl } from "./projects";

const status: ProjectField = { id: "F_s", name: "Status", kind: "single_select", options: [{ id: "o1", name: "Todo", start: "", days: 0 }, { id: "o2", name: "Done", start: "", days: 0 }] };
const points: ProjectField = { id: "F_p", name: "Points", kind: "number", options: [] };
const repo: ProjectField = { id: "F_r", name: "Repository", kind: "repository", options: [] };
const labels: ProjectField = { id: "F_l", name: "Labels", kind: "labels", options: [] };
const item = (id: string, over: Partial<ProjectItem> = {}): ProjectItem => ({ id, kind: "issue", title: id, number: 1, url: "", repo: "acme/app", state: "open", labels: [], assignees: [], values: {}, ...over });
const cell = (text: string, id = "") => ({ text, id, start: "", days: 0 });

describe("T-314-c GitHub Projects", () => {
  it("reads a pasted project URL or an owner and number, and nothing else", () => {
    expect(parseProjectRef("https://github.com/orgs/acme/projects/3/views/2", "x")).toEqual({ host: "github.com", owner: "acme", number: 3, view: 2 });
    expect(parseProjectRef("https://GHE.example.com/users/ana-b/projects/12", "github.com")).toEqual({ host: "ghe.example.com", owner: "ana-b", number: 12, view: null });
    for (const t of ["acme 3", "acme/3", "acme#3", "@acme 3"]) expect(parseProjectRef(t, "github.com")).toEqual({ host: "github.com", owner: "acme", number: 3, view: null });
    for (const t of ["", "acme", "acme 0", "-acme 3", "ac--me 3", "a\"b 3", "https://github.com/acme/app/issues/3", "http://github.com/orgs/acme/projects/3"]) expect(parseProjectRef(t, "github.com")).toBeNull();
  });

  it("the picker label and the view agree that only table views are supported", () => {
    expect(["table", "board", "roadmap"].map(viewSupport)).toEqual(["table", "unsupported", "unsupported"]);
    expect(viewLabel({ number: 2, name: "Plan", layout: "roadmap" })).toBe("Plan (roadmap, not supported)");
    expect(viewLabel({ number: 1, name: "All", layout: "table" })).toBe("All");
  });

  it("opens the remembered view, else the first table view", () => {
    const views = [{ number: 1, name: "B", layout: "board" }, { number: 4, name: "T", layout: "table" }];
    expect(openingView({ views }, 1)).toBe(1);
    expect(openingView({ views }, 9)).toBe(4);
    expect(openingView({ views: [views[0]] }, null)).toBe(1);
    expect(openingView({ views: [] }, null)).toBeNull();
  });

  it("remembers recent projects newest first and once each, and pins toggle", () => {
    const r = (n: number) => ({ host: "github.com", owner: "Acme", number: n, title: "" });
    let recent = [1, 2, 3, 4, 5, 6, 7, 8].map(r);
    recent = pushRecent(recent, { ...r(3), owner: "acme" });
    expect(recent.map((x) => x.number)).toEqual([3, 1, 2, 4, 5, 6, 7, 8]);
    expect(pushRecent(recent, r(9)).map((x) => x.number)).toEqual([9, 3, 1, 2, 4, 5, 6, 7]);
    expect(togglePin(togglePin([], r(1)), r(1))).toEqual([]);
    expect(refsFrom([r(1), { host: "github.com", owner: "a b", number: 1 }, { owner: "x" }, null, "x"])).toEqual([r(1)]);
    expect(refsFrom("nope")).toEqual([]);
  });

  it("sorts numbers by value and single-select by option order, empty cells last both ways", () => {
    const a = item("a", { values: { F_p: cell("10"), F_s: cell("Done", "o2") } });
    const b = item("b", { values: { F_p: cell("9"), F_s: cell("Todo", "o1") } });
    const c = item("c");
    const r = item("r", { kind: "restricted", values: {} });
    expect(sortItems([a, c, b, r], points, 1).map((x) => x.id)).toEqual(["b", "a", "c", "r"]);
    expect(sortItems([a, c, b, r], points, -1).map((x) => x.id)).toEqual(["a", "b", "c", "r"]);
    expect(sortItems([a, b], status, 1).map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("groups in the field's option order with the empty group last", () => {
    const a = item("a", { values: { F_s: cell("Done", "o2") } });
    const b = item("b", { values: { F_s: cell("Todo", "o1") } });
    const c = item("c");
    expect(groupItems([a, c, b], status).map((g) => [g.label, g.items.map((x) => x.id)])).toEqual([["Todo", ["b"]], ["Done", ["a"]], ["No status", ["c"]]]);
    expect(groupItems([item("x", { repo: "z/z" }), item("y", { repo: "a/a" })], repo).map((g) => g.label)).toEqual(["a/a", "z/z"]);
  });

  it("limits rows to repositories open in Kolux or chosen ones, leaving out drafts and restricted items", () => {
    const rows = [item("a", { repo: "Acme/App" }), item("b", { repo: "acme/other" }), item("d", { kind: "draft", repo: "" }), item("r", { kind: "restricted", repo: "" })];
    expect(scopeItems(rows, { mode: "all" }, []).length).toBe(4);
    expect(scopeItems(rows, { mode: "kolux" }, ["acme/app"]).map((x) => x.id)).toEqual(["a"]);
    expect(scopeItems(rows, { mode: "chosen", repos: ["acme/other"] }, ["acme/app"]).map((x) => x.id)).toEqual(["b"]);
  });

  it("restricted items and drafts' labels are not editable; labels change as add and remove lists", () => {
    expect(cellEditable(item("r", { kind: "restricted" }), status)).toBe(false);
    expect(cellEditable(item("a"), status)).toBe(true);
    expect(cellEditable(item("a"), labels)).toBe(true);
    expect(cellEditable(item("d", { kind: "draft", repo: "", number: null }), labels)).toBe(false);
    expect(cellEditable(item("a"), repo)).toBe(false);
    expect(labelChange(["bug", "docs"], "Bug, ui, ui,")).toEqual({ add: ["ui"], remove: ["docs"] });
  });

  it("opens a view on GitHub only from an https project address", () => {
    expect(viewUrl({ url: "https://github.com/orgs/acme/projects/3" }, 2)).toBe("https://github.com/orgs/acme/projects/3/views/2");
    expect(viewUrl({ url: "javascript:alert(1)" }, 2)).toBeNull();
  });
});
