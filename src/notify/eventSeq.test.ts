import { expect, test } from "vitest";
import { decide, emptyPacer, paneFor } from "./pacing";
import { noteId } from "./pace";

const opts = { windowFocused: false, suppressFocused: false };

test("T-125-b two events from one pane with the same words in one millisecond get distinct ids and both reach the click lookup", () => {
  const a = noteId();
  const b = noteId();
  expect(a).not.toBe(b);
  const at = 1_000;
  let r = decide(emptyPacer(), { id: a, worktree: "C:/w/a", pane: "7", kind: "finish", at }, opts);
  r = decide(r.state, { id: b, worktree: "C:/w/a", pane: "7", kind: "finish", at }, opts);
  expect(r.reason).toBe("cooldown");
  expect(paneFor(r.state, a)).toBe("7");
  expect(paneFor(r.state, b)).toBe("7");
});

test("T-125-b ids count up, so a later event never sorts or compares equal to an earlier one", () => {
  const ids = Array.from({ length: 50 }, () => noteId());
  expect(new Set(ids).size).toBe(50);
  const seqs = ids.map((i) => Number(i.split(".")[1]));
  expect(seqs.every((n, i) => i === 0 || n === seqs[i - 1] + 1)).toBe(true);
});
