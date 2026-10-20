import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedLayout } from "./layout";
import { layoutWriter } from "./layoutSave";

const layout = (focused: number): SavedLayout => ({ panes: [{ key: 1, cwd: "C:\\w\\a", branch: null, agent: "shell", program: null, args: [] }, { key: 2, cwd: "C:\\w\\a", branch: null, agent: "shell", program: null, args: [], kind: "editor", path: "C:\\w\\a\\README.md" }], activeTab: {}, focused, activeDir: "C:\\w\\a", stacked: {} });

describe("T-075 (APP-048): the layout writer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("turns a burst of changes into one write of the newest layout, after the quiet time", () => {
    const writes: SavedLayout[] = [];
    const w = layoutWriter((l) => writes.push(l), 400);
    w.set(layout(1));
    vi.advanceTimersByTime(300);
    w.set(layout(2));
    vi.advanceTimersByTime(300);
    expect(writes).toEqual([]); // the second change restarted the quiet time
    expect(w.pending()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(writes.map((l) => l.focused)).toEqual([2]);
    expect(w.pending()).toBe(false);
  });

  it("flush writes what is pending at once (the quit path) and is a no-op with nothing pending", () => {
    const writes: SavedLayout[] = [];
    const w = layoutWriter((l) => writes.push(l), 400);
    w.flush();
    expect(writes).toEqual([]);
    w.set(layout(1));
    w.flush();
    expect(writes.map((l) => l.focused)).toEqual([1]);
    vi.advanceTimersByTime(1000);
    expect(writes.length).toBe(1); // the timer was cleared by the flush
  });

  it("does not write a layout equal to the last one written", () => {
    const writes: SavedLayout[] = [];
    const w = layoutWriter((l) => writes.push(l), 400);
    w.set(layout(1));
    vi.advanceTimersByTime(400);
    w.set(layout(1));
    vi.advanceTimersByTime(400);
    expect(writes.length).toBe(1);
    w.set(layout(3));
    w.flush();
    expect(writes.length).toBe(2);
  });

  it("keeps the editor tab of a worktree in what it writes (T-093-a)", () => {
    const writes: SavedLayout[] = [];
    const w = layoutWriter((l) => writes.push(l), 400);
    w.set(layout(2));
    w.flush();
    expect(writes[0].panes[1]).toMatchObject({ kind: "editor", path: "C:\\w\\a\\README.md", cwd: "C:\\w\\a" });
  });
});
