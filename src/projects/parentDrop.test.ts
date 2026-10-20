// PROJ-048: dropping a workspace row on the middle of another makes it a child; edges reorder.
import { expect, test } from "vitest";
import { dropBand, parentDropTarget } from "./parentDrop";
import type { Worktree } from "./model";

const w = (path: string, over: Partial<Worktree> = {}): Worktree => ({ path, branch: path, head: "x", isMain: false, ...over });
const main = w("C:/r", { isMain: true });
const a = w("C:/ws/a");
const kid = w("C:/ws/kid", { parent: "C:/ws/a" });
const b = w("C:/ws/b");
const all = [main, a, kid, b];

test("PROJ-048 only the middle half of a row takes a parent drop; the edges reorder", () => {
  expect(dropBand(2, 40)).toBe("above");
  expect(dropBand(20, 40)).toBe("parent");
  expect(dropBand(10, 40)).toBe("parent");
  expect(dropBand(30, 40)).toBe("parent");
  expect(dropBand(38, 40)).toBe("below");
  expect(dropBand(5, 0)).toBe("below");
});

test("PROJ-048 a middle drop nests under the row, but never under itself, its own child, the main checkout or its current parent", () => {
  expect(parentDropTarget(all, "C:/ws/b", "C:/ws/a", "parent")?.path).toBe("C:/ws/a");
  expect(parentDropTarget(all, "C:\\ws\\b", "c:\\WS\\a", "parent")?.path).toBe("C:/ws/a");
  expect(parentDropTarget(all, "C:/ws/b", "C:/ws/a", "above")).toBeNull();
  expect(parentDropTarget(all, "C:/ws/b", "C:/ws/a", "below")).toBeNull();
  expect(parentDropTarget(all, "C:/ws/a", "C:/ws/a", "parent")).toBeNull();
  expect(parentDropTarget(all, "C:/ws/a", "C:/ws/kid", "parent")).toBeNull();
  expect(parentDropTarget(all, "C:/ws/b", "C:/r", "parent")).toBeNull();
  expect(parentDropTarget(all, "C:/ws/kid", "C:/ws/a", "parent")).toBeNull();
  expect(parentDropTarget(all, "C:/r", "C:/ws/a", "parent")).toBeNull();
  expect(parentDropTarget(all, "C:/ws/nowhere", "C:/ws/a", "parent")).toBeNull();
});
