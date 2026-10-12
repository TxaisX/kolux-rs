import { expect, test } from "vitest";
import { noteTitle, preview, turnNote } from "./notify";

const turn = (state: string, extra: object = {}) => ({ state, interrupted: false, boundary: false, ...extra }) as Parameters<typeof turnNote>[1];

test("a finish, a permission request and a block are notes; boundaries, replays and plain progress are not (STAT-041)", () => {
  expect(turnNote("working", turn("done", { reply: "All tests pass.\n\nNext: ship it." }))).toEqual({ what: "finished", body: "All tests pass. Next: ship it." });
  expect(turnNote("working", turn("permission"))).toEqual({ what: "needs permission", body: "" });
  expect(turnNote("working", turn("blocked", { reply: "Usage limit reached" }))).toEqual({ what: "is blocked", body: "Usage limit reached" });
  expect(turnNote("working", turn("interrupted"))).toEqual({ what: "was interrupted", body: "" });
  expect(turnNote("working", turn("done", { boundary: true }))).toBeNull();
  expect(turnNote(undefined, turn("done"))).toBeNull();
  expect(turnNote("done", turn("done"))).toBeNull();
  expect(turnNote("working", turn("working"))).toBeNull();
  expect(turnNote("working", turn("waiting"))).toBeNull();
});

test("every sub-agent turn is a note of its own, even while the lead stays working (STAT-041)", () => {
  expect(turnNote("working", turn("working", { child: "code-reviewer", reply: "Two findings." }))).toEqual({ what: "code-reviewer finished", body: "Two findings." });
});

test("the title carries the repository only when several have agents; long replies are cut (STAT-041)", () => {
  expect(noteTitle("Claude 2", null, "finished")).toBe("Claude 2 finished");
  expect(noteTitle("Claude 2", "kolux-rs", "finished")).toBe("kolux-rs · Claude 2 finished");
  expect(preview("x".repeat(200))).toHaveLength(120);
  expect(preview("x".repeat(200)).endsWith("…")).toBe(true);
});
