import { describe, expect, it } from "vitest";
import { diffSplitOf, targetCell } from "./split";

describe("GIT-037: which split a diff opens in", () => {
  it("reads the setting with 'this split' as the default", () => {
    expect(diffSplitOf(undefined)).toBe("here");
    expect(diffSplitOf("nonsense")).toBe("here");
    expect(diffSplitOf("beside")).toBe("beside");
    expect(diffSplitOf("new")).toBe("new");
  });
  it("'this split' is the focused pane's cell", () => {
    expect(targetCell([0, 1, 2], 1, "here")).toBe(1);
  });
  it("'next split' is the cell after the focused one, wrapping around", () => {
    expect(targetCell([0, 1, 2], 1, "beside")).toBe(2);
    expect(targetCell([0, 1, 2], 2, "beside")).toBe(0);
  });
  it("'next split' with a single cell, and 'new split' always, open a cell of their own", () => {
    expect(targetCell([0], 0, "beside")).toBeUndefined();
    expect(targetCell([0, 1], 0, "new")).toBeUndefined();
  });
  it("nothing focused in the workspace: a cell of its own, whatever the choice", () => {
    expect(targetCell([0, 1], undefined, "here")).toBeUndefined();
    expect(targetCell([0, 1], undefined, "beside")).toBeUndefined();
  });
});
