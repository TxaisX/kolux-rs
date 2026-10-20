import { describe, expect, it } from "vitest";
import { firstSave, type FirstSaveIo } from "./firstSave";

function fake(taken: string[] = [], fail: Partial<Record<keyof FirstSaveIo, string>> = {}) {
  const log: string[] = [];
  const io: FirstSaveIo = {
    exists: async (p) => taken.includes(p),
    makeFolder: async (d, n) => {
      if (fail.makeFolder) throw new Error(fail.makeFolder);
      log.push(`mkdir ${d}/${n}`);
    },
    write: async (p, t) => {
      if (fail.write) throw new Error(fail.write);
      log.push(`write ${p} ${t.length}`);
    },
    remove: async (p) => {
      if (fail.remove) throw new Error(fail.remove);
      log.push(`remove ${p}`);
    },
  };
  return { io, log };
}
const root = "C:/w";
const old = "C:/w/untitled.md";

describe("EDIT-054 the first save of an untitled note (T-236-b / T-237-b)", () => {
  it("makes the folders, writes the text under the new name, then removes the empty file", async () => {
    const { io, log } = fake();
    const r = await firstSave(io, root, old, "notes/ideas/plan", "hello");
    expect(r).toEqual({ ok: true, path: "C:/w/notes/ideas/plan.md", same: false });
    expect(log).toEqual(["mkdir C:/w/notes", "mkdir C:/w/notes/ideas", "write C:/w/notes/ideas/plan.md 5", "remove C:/w/untitled.md"]);
  });
  it("the suggested name writes nothing here (the caller saves in place)", async () => {
    const { io, log } = fake();
    expect(await firstSave(io, root, old, "untitled.md", "x")).toEqual({ ok: true, path: "C:/w/untitled.md", same: true });
    expect(log).toEqual([]);
  });
  it("a name that exists is refused and nothing moves", async () => {
    const { io, log } = fake(["C:/w/plan.md"]);
    const r = await firstSave(io, root, old, "plan", "x");
    expect(r).toEqual({ ok: false, error: "plan.md already exists; choose another name." });
    expect(log).toEqual([]);
  });
  it("a bad name is refused before any disk work", async () => {
    const { io, log } = fake();
    for (const t of ["", "../x", "a:b", "C:/x/y", "con"]) expect((await firstSave(io, root, old, t, "x")).ok).toBe(false);
    expect(log).toEqual([]);
  });
  it("a failed write keeps the untitled file and reports it; a failed removal still counts as saved", async () => {
    const w = fake([], { write: "disk full" });
    const r = await firstSave(w.io, root, old, "a", "x");
    expect(r.ok).toBe(false);
    expect(w.log.some((l) => l.startsWith("remove"))).toBe(false);
    const d = fake([], { remove: "locked" });
    const r2 = await firstSave(d.io, root, old, "a", "x");
    expect(r2.ok && r2.path === "C:/w/a.md" && !!r2.note).toBe(true);
  });
});
