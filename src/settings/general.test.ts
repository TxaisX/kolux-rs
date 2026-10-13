import { expect, test, vi } from "vitest";
import { lastWriter, openPageAt, readLook, savedFirst, stampLook, startScreen } from "./general";

test("a fresh profile is New, an existing one without the choice is Classic", () => {
  expect(readLook({})).toBe("new");
  expect(readLook({ defaultAgent: "claude" })).toBe("classic");
  expect(readLook({ defaultAgent: "claude", uiLook: "new" })).toBe("new");
  expect(readLook({ uiLook: "fancy", x: 1 })).toBe("classic");
});

test("the look is written down once, so a fresh profile stays New", () => {
  expect(stampLook({})).toEqual({ uiLook: "new" });
  expect(stampLook({ a: 1 })).toEqual({ a: 1, uiLook: "classic" });
  expect(stampLook({ uiLook: "new" })).toBeNull();
});

test("the first screen counts only under New", () => {
  expect(startScreen({ uiLook: "new", firstScreen: "board" })).toBe("board");
  expect(startScreen({ uiLook: "classic", firstScreen: "board" })).toBe("terminals");
  expect(savedFirst({ firstScreen: "elsewhere" })).toBe("terminals");
});

test("VIEW-005: the screen left at quit comes back, an unknown one falls back", () => {
  expect(startScreen({ uiLook: "new", firstScreen: "agents", lastScreen: "board" })).toBe("board");
  expect(startScreen({ uiLook: "new", lastScreen: "artifacts" })).toBe("artifacts");
  expect(startScreen({ uiLook: "classic", lastScreen: "inbox" })).toBe("inbox");
  expect(startScreen({ uiLook: "classic", lastScreen: "board" })).toBe("terminals");
  expect(startScreen({ uiLook: "new", firstScreen: "agents", lastScreen: "settings" })).toBe("agents");
  expect(startScreen({ uiLook: "new", lastScreen: 7 })).toBe("terminals");
});

test("VIEW-005: quick switches are one write, a close flushes the last one", () => {
  vi.useFakeTimers();
  const writes: string[] = [];
  const w = lastWriter((v: string) => writes.push(v), 400);
  w.set("board");
  w.set("agents");
  vi.advanceTimersByTime(399);
  expect(writes).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(writes).toEqual(["agents"]);
  w.set("inbox");
  w.flush();
  w.flush();
  expect(writes).toEqual(["agents", "inbox"]);
  vi.useRealTimers();
});

test("VIEW-011: the page open at quit comes back", () => {
  expect(openPageAt({ openPage: "tasks" })).toBe("tasks");
  expect(openPageAt({ openPage: "automations" })).toBe("automations");
  expect(openPageAt({ openPage: "routing" })).toBe("routing");
  expect(openPageAt({ openPage: "skills" })).toBe(null);
  expect(openPageAt({})).toBe(null);
});
