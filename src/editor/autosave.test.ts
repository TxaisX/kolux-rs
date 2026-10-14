import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, type Transaction } from "@codemirror/state";
import { attach, detach, isDirty, keepMine, relay, type View } from "./buffers";
import { AUTOSAVE_KEY, AUTOSAVE_PAUSE_KEY, autosaveOf, isStopped, resumeAutosave, stopAutosave, watchAutosave } from "./autosave";

function fakeView(path: string, text: string): View & { type: (s: string) => void } {
  const v = {
    state: EditorState.create({ doc: text }),
    dispatch(spec: Parameters<View["dispatch"]>[0]) {
      const tr: Transaction = v.state.update(spec);
      v.state = tr.state;
      relay(path, v, tr);
    },
    type(s: string) {
      const tr = v.state.update({ changes: { from: 0, insert: s } });
      v.state = tr.state;
      relay(path, v, tr);
    },
  };
  return v;
}

afterEach(() => vi.useRealTimers());

describe("autosave setting (EDIT-002)", () => {
  it("is off on a new install and the pause is held to a quarter second .. ten seconds", () => {
    expect(autosaveOf({})).toBeNull();
    expect(autosaveOf({ [AUTOSAVE_KEY]: false, [AUTOSAVE_PAUSE_KEY]: 2000 })).toBeNull();
    expect(autosaveOf({ [AUTOSAVE_KEY]: true })).toBe(1000);
    expect(autosaveOf({ [AUTOSAVE_KEY]: true, [AUTOSAVE_PAUSE_KEY]: 2500 })).toBe(2500);
    expect(autosaveOf({ [AUTOSAVE_KEY]: true, [AUTOSAVE_PAUSE_KEY]: 10 })).toBe(250);
    expect(autosaveOf({ [AUTOSAVE_KEY]: true, [AUTOSAVE_PAUSE_KEY]: 60000 })).toBe(10000);
    for (const bad of ["x", null, NaN, Infinity, {}, "1500"]) expect(autosaveOf({ [AUTOSAVE_KEY]: true, [AUTOSAVE_PAUSE_KEY]: bad })).toBe(1000);
    expect(autosaveOf({ [AUTOSAVE_KEY]: "yes" })).toBeNull();
  });
});

describe("autosave writes after the pause (EDIT-002)", () => {
  it("writes once after typing stops, and the marker clears", async () => {
    vi.useFakeTimers();
    const p = "C:/w/a.txt";
    const v = fakeView(p, "one\n");
    attach(p, v, "one\n");
    const writes: string[] = [];
    let disk = "one\n";
    const off = watchAutosave(p, 1000, async (t) => void writes.push((disk = t)), async () => disk, () => undefined);
    v.type("a");
    await vi.advanceTimersByTimeAsync(600);
    v.type("b");
    await vi.advanceTimersByTimeAsync(600);
    expect(writes).toEqual([]); // typing again starts the pause over
    await vi.advanceTimersByTimeAsync(500);
    await vi.waitFor(() => expect(writes).toEqual(["baone\n"])); // the save hashes the loaded copy first (real crypto)
    expect(isDirty(p)).toBe(false);
    off();
    detach(p, v);
  });

  it("never overwrites a disk copy another program changed, and stands down until the file is resolved", async () => {
    vi.useFakeTimers();
    const p = "C:/w/b.txt";
    const v = fakeView(p, "one\n");
    attach(p, v, "one\n");
    const writes: string[] = [];
    const conflicts: string[] = [];
    let disk = "one\n";
    const off = watchAutosave(p, 300, async (t) => void writes.push((disk = t)), async () => disk, (d) => conflicts.push(d));
    v.type("x");
    disk = "outside\n"; // another program wrote the file inside the pause
    await vi.advanceTimersByTimeAsync(400);
    expect(writes).toEqual([]);
    expect(conflicts).toEqual(["outside\n"]);
    expect(isStopped(p)).toBe(true);
    v.type("y"); // more typing while the banner is up writes nothing
    await vi.advanceTimersByTimeAsync(400);
    expect(writes).toEqual([]);
    expect(conflicts.length).toBe(1);
    keepMine(p, "outside" + String.fromCharCode(10)); // Keep my edits
    resumeAutosave(p);
    v.type("z");
    await vi.advanceTimersByTimeAsync(400);
    await vi.waitFor(() => expect(writes.length).toBe(1));
    off();
    detach(p, v);
  });

  it("stands down while the banner is up, and a disk read that fails writes nothing", async () => {
    vi.useFakeTimers();
    const p = "C:/w/c.txt";
    const v = fakeView(p, "one\n");
    attach(p, v, "one\n");
    const writes: string[] = [];
    let readable = true;
    const off = watchAutosave(p, 300, async (t) => void writes.push(t), async () => (readable ? "one\n" : Promise.reject("gone")), () => undefined);
    stopAutosave(p);
    v.type("x");
    await vi.advanceTimersByTimeAsync(400);
    expect(writes).toEqual([]);
    resumeAutosave(p);
    readable = false;
    v.type("y");
    await vi.advanceTimersByTimeAsync(400);
    expect(writes).toEqual([]);
    readable = true;
    v.type("z");
    await vi.advanceTimersByTimeAsync(400);
    await vi.waitFor(() => expect(writes).toEqual(["zyxone\n"]));
    off();
    detach(p, v);
  });
});
