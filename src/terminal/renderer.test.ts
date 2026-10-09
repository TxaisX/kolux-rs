import { expect, test } from "vitest";
import { attachRenderer, type WebglLike } from "./renderer";

function fakeWebgl(): WebglLike & { disposed: number; lose: () => void } {
  let lose = () => {};
  return {
    disposed: 0,
    dispose() {
      this.disposed++;
    },
    onContextLoss(l) {
      lose = l;
    },
    lose: () => lose(),
  };
}

test("GPU path is used when the WebGL addon loads", () => {
  const loaded: unknown[] = [];
  const choice = attachRenderer({ loadAddon: (a) => loaded.push(a) }, fakeWebgl);
  expect(choice.mode).toBe("webgl");
  expect(loaded).toHaveLength(1);
});

test("falls back to the plain path when WebGL refuses to load, and the pane keeps working", () => {
  const loaded: unknown[] = [];
  const choice = attachRenderer(
    {
      loadAddon: () => {
        throw new Error("no WebGL2 context");
      },
    },
    fakeWebgl,
  );
  expect(choice.mode).toBe("dom");
  expect(loaded).toHaveLength(0);
});

test("falls back when the addon constructor itself throws", () => {
  const choice = attachRenderer({ loadAddon: () => {} }, () => {
    throw new Error("webgl addon unavailable");
  });
  expect(choice.mode).toBe("dom");
});

test("a lost GPU context disposes the addon and reports the fallback", () => {
  const addon = fakeWebgl();
  const choice = attachRenderer({ loadAddon: () => {} }, () => addon);
  const reasons: string[] = [];
  choice.onFallback((r) => reasons.push(r));
  addon.lose();
  expect(addon.disposed).toBe(1);
  expect(reasons).toEqual(["context lost"]);
});

test("GPU can be switched off outright", () => {
  const choice = attachRenderer({ loadAddon: () => {} }, fakeWebgl, false);
  expect(choice.mode).toBe("dom");
});
