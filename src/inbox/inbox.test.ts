import { expect, test } from "vitest";
import { DONE_LIMIT, inboxItems, moveSelection, openLabel, settle, type Source } from "./inbox";

const MIN = 60_000;
const now = 10_000 * MIN;
const src = (key: number, state: Source["state"], extra: Partial<Source> = {}): Source => ({ key, agent: "claude", title: `Claude ${key}`, branch: "main", cwd: "G:/repo", state, interrupted: false, running: true, changed: now - key * MIN, finishedAt: null, ...extra });

test("two agents waiting and one finished are two needs-you items and one done-today item, newest first (STAT-050)", () => {
  const items = inboxItems([src(1, "permission"), src(2, "waiting"), src(3, "done", { finishedAt: now - 5 * MIN }), src(4, "working"), src(5, "idle", { agent: "shell", running: false })], now);
  expect(items.map((i) => [i.group, i.key, i.label])).toEqual([
    ["needs", 1, "Permission"],
    ["needs", 2, "Question"],
    ["waiting", 4, "Running"],
    ["done", 3, "Done"],
  ]);
  // Prompts that ask for approval are permissions, the rest questions; a blocked agent needs you too.
  expect(inboxItems([src(1, "blocked")], now)[0]).toMatchObject({ group: "needs", label: "Blocked" });
});

test("done today leaves out the interrupted, anything older than 30 minutes, and everything past the 20 newest (STAT-050)", () => {
  expect(inboxItems([src(1, "done", { finishedAt: now - 40 * MIN })], now)).toEqual([]);
  expect(inboxItems([src(1, "done", { finishedAt: now - 30 * MIN })], now)).toHaveLength(1);
  expect(inboxItems([src(1, "interrupted", { finishedAt: now - MIN })], now)).toEqual([]);
  expect(inboxItems([src(1, "done", { finishedAt: now - MIN, interrupted: true })], now)).toEqual([]);
  const many = Array.from({ length: 25 }, (_, i) => src(i + 1, "done", { finishedAt: now - i * 1000 }));
  const done = inboxItems(many, now);
  expect(done).toHaveLength(DONE_LIMIT);
  expect(done[0].key).toBe(1);
  expect(done[DONE_LIMIT - 1].key).toBe(DONE_LIMIT);
});

test("Down with nothing selected picks the first row, Up the last; movement stops at both ends; a vanished selection goes back to the first row (STAT-050)", () => {
  const keys = [7, 8, 9];
  expect(moveSelection(keys, null, 1)).toBe(7);
  expect(moveSelection(keys, null, -1)).toBe(9);
  expect(moveSelection(keys, 7, -1)).toBe(7);
  expect(moveSelection(keys, 9, 1)).toBe(9);
  expect(moveSelection(keys, 7, 1)).toBe(8);
  expect(moveSelection([], null, 1)).toBeNull();
  expect(settle(keys, 8)).toBe(8);
  expect(settle(keys, 5)).toBe(7);
  expect(settle([], 5)).toBeNull();
  expect(settle(keys, null)).toBeNull();
});

test("an item that needs an answer offers Answer in Code, since nothing is answered in the Inbox yet; the rest offer Open in Code (EDIT-041)", () => {
  const items = inboxItems([src(1, "permission", { running: false }), src(2, "waiting"), src(3, "working"), src(4, "done", { finishedAt: now - MIN })], now);
  expect(items.map((i) => [i.key, openLabel(i)])).toEqual([
    [1, "Answer in Code"],
    [2, "Answer in Code"],
    [3, "Open in Code"],
    [4, "Open in Code"],
  ]);
});
