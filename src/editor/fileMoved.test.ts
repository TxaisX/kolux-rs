import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { attach, detach, takeCarried, type View } from "./buffers";
import { movingNow } from "./autosave";
import { announceMoves, confirmed, MOVED_EVENT, movedPath, type Move } from "./fileMoved";

// EDIT-032 (T-177): a renamed or moved file keeps its tab and its unsaved edits.
const open: [string, View][] = [];
function tab(path: string, disk: string, typed: string) {
  let state = EditorState.create({ doc: typed });
  const v = {
    get state() {
      return state;
    },
    dispatch: () => undefined,
  } as unknown as View;
  attach(path, v, disk);
  open.push([path, v]);
}
afterEach(() => {
  open.splice(0).forEach(([p, v]) => detach(p, v));
  vi.useRealTimers();
});

describe("where a path goes", () => {
  it("a renamed file goes to its new name, a moved folder takes the files under it, others stay", () => {
    const moves: Move[] = [["C:/w/a.md", "C:/w/b.md"], ["C:/w/docs", "C:/w/archive/docs"]];
    expect(movedPath("C:\\w\\A.md", moves)).toBe("C:/w/b.md");
    expect(movedPath("C:/w/docs/x/y.md", moves)).toBe("C:/w/archive/docs/x/y.md");
    expect(movedPath("C:/w/docs2/y.md", moves)).toBeNull();
    expect(movedPath("C:/w/other.md", moves)).toBeNull();
  });
});

describe("a tab follows its file", () => {
  it("unsaved text is carried to the new path and the new place holds autosave until it is confirmed", () => {
    const target = new EventTarget();
    const heard: Move[][] = [];
    target.addEventListener(MOVED_EVENT, (e) => heard.push((e as CustomEvent<Move[]>).detail));
    tab("C:/w/mv-a.md", "disk\n", "disk\nmy edit\n");
    const carried = announceMoves([["C:/w/mv-a.md", "C:/w/mv-b.md"]], target);
    expect(carried).toEqual(["c:/w/mv-b.md"]);
    expect(heard).toEqual([[["C:/w/mv-a.md", "C:/w/mv-b.md"]]]);
    expect(movingNow("C:/w/mv-b.md")).toBe(true);
    expect(takeCarried("C:/w/mv-b.md")).toEqual({ text: "disk\nmy edit\n", disk: "disk\n" });
    expect(takeCarried("C:/w/mv-b.md")).toBeNull();
    confirmed("C:/w/mv-b.md");
    expect(movingNow("C:/w/mv-b.md")).toBe(false);
  });

  it("a folder move carries every unsaved file under it; clean files carry nothing", () => {
    tab("C:/w/dir/one.md", "1", "1 edited");
    tab("C:/w/dir/two.md", "2", "2");
    const carried = announceMoves([["C:/w/dir", "C:/w/sub/dir"]], null);
    expect(carried).toEqual(["c:/w/sub/dir/one.md"]);
    expect(takeCarried("C:/w/sub/dir/one.md")?.text).toBe("1 edited");
    expect(takeCarried("C:/w/sub/dir/two.md")).toBeNull();
    confirmed("C:/w/sub/dir/one.md");
  });

  it("the hold lifts by itself if the new place is never confirmed", () => {
    vi.useFakeTimers();
    tab("C:/w/mv-c.md", "d", "d!");
    announceMoves([["C:/w/mv-c.md", "C:/w/mv-d.md"]], null);
    expect(movingNow("C:/w/mv-d.md")).toBe(true);
    vi.advanceTimersByTime(10001);
    expect(movingNow("C:/w/mv-d.md")).toBe(false);
    takeCarried("C:/w/mv-d.md");
  });

  it("no moves, nothing happens (a rename that hit a taken name never gets here, so the tab stays)", () => {
    expect(announceMoves([], null)).toEqual([]);
  });
});
