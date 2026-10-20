import { describe, expect, it, vi } from "vitest";
import { beginNote, rows, step } from "./templates";

describe("note templates (EDIT-055)", () => {
  const meeting = { name: "Meeting notes", path: "C:/r/.kolux/templates/meeting-notes.md" };
  const bug = { name: "Bug report", path: "C:/r/.kolux/templates/sub/bug-report.md" };

  it("lists Blank first and then every template by its name", () => {
    expect(rows([meeting, bug])).toEqual([
      { label: "Blank", path: null },
      { label: "Meeting notes", path: meeting.path },
      { label: "Bug report", path: bug.path },
    ]);
    expect(rows([])).toEqual([{ label: "Blank", path: null }]);
  });

  it("moves the highlight with the arrows and stops at both ends", () => {
    expect(step(0, "ArrowDown", 3)).toBe(1);
    expect(step(2, "ArrowDown", 3)).toBe(2);
    expect(step(0, "ArrowUp", 3)).toBe(0);
    expect(step(2, "ArrowUp", 3)).toBe(1);
    expect(step(1, "x", 3)).toBe(1);
  });

  it("makes a blank note at once, with no picker, when the repository has no templates", async () => {
    const make = vi.fn(async () => "C:/r/untitled.md");
    expect(await beginNote("C:/r", { list: async () => [], make })).toEqual({ opened: "C:/r/untitled.md" });
    expect(make).toHaveBeenCalledWith("C:/r", null);
  });

  it("asks, and makes nothing yet, when there are templates", async () => {
    const make = vi.fn(async () => "x");
    expect(await beginNote("C:/r", { list: async () => [meeting, bug], make })).toEqual({ ask: [meeting, bug] });
    expect(make).not.toHaveBeenCalled();
  });

  it("falls back to a blank note when the templates folder cannot be read", async () => {
    const make = vi.fn(async () => "C:/r/untitled.md");
    expect(await beginNote("C:/r", { list: async () => Promise.reject("denied"), make })).toEqual({ opened: "C:/r/untitled.md" });
  });
});
