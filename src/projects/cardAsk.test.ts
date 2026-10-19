import { describe, expect, it } from "vitest";
import { cardProjectOf, newestOnly } from "./cardAsk";

describe("PROJ-035 the card's asking", () => {
  it("only the newest ask may show its answer", async () => {
    const asks = newestOnly();
    const shown: string[] = [];
    const ask = async (label: string, wait: number) => {
      const mine = asks.begin();
      await new Promise((r) => setTimeout(r, wait));
      if (mine()) shown.push(label);
    };
    // a slow answer for the old workspace lands after the quick one for the new workspace
    await Promise.all([ask("old", 20), ask("new", 1)]);
    expect(shown).toEqual(["new"]);
    // an ask that began and was never followed still shows
    await ask("alone", 1);
    expect(shown).toEqual(["new", "alone"]);
  });

  it("an ask that clears the card also cancels the one still in flight", async () => {
    const asks = newestOnly();
    const mine = asks.begin();
    asks.begin(); // the active workspace left every project: the card was cleared
    expect(mine()).toBe(false);
  });

  it("finds the project whose workspace is active, by the panel's own path comparison", () => {
    const projects = [{ id: "a", path: "C:/a" }, { id: "b", path: "C:/b" }];
    const worktrees = { a: [{ path: "C:/a" }, { path: "C:/ws/a1" }], b: [{ path: "C:/b" }] };
    const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();
    expect(cardProjectOf(projects, worktrees, "c:/WS/a1", same)?.id).toBe("a");
    expect(cardProjectOf(projects, worktrees, "C:/b", same)?.id).toBe("b");
    expect(cardProjectOf(projects, worktrees, "C:/elsewhere", same)).toBeNull();
    expect(cardProjectOf(projects, worktrees, null, same)).toBeNull();
    expect(cardProjectOf(projects, {}, "C:/a", same)).toBeNull();
  });

  it("the same project and folder give the same key whatever else in the list changed", () => {
    const projects = [{ id: "a", path: "C:/a" }];
    const same = (x: string, y: string) => x === y;
    const one = cardProjectOf(projects, { a: [{ path: "C:/a" }] }, "C:/a", same);
    const two = cardProjectOf(projects, { a: [{ path: "C:/a" }, { path: "C:/new" }] }, "C:/a", same);
    expect(two?.id).toBe(one?.id);
    expect(two?.path).toBe(one?.path);
  });
});
