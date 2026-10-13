import { expect, test } from "vitest";
import { attachRenderer, GPU_FIELD, gpuOn, watchResume, type WebglLike } from "./renderer";

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

// TERM-103 (T-067): at most six GPU contexts at a time, hidden tabs counted; the rest draw plain.
test("the seventh terminal draws plain while six hold a GPU context, and a closed one hands its slot on", () => {
  const pool = { max: 6, live: 0 };
  const hosts = Array.from({ length: 8 }, () => ({ loadAddon() {} }));
  const choices = hosts.map((h) => attachRenderer(h, fakeWebgl, true, pool));
  expect(choices.map((c) => c.mode)).toEqual(["webgl", "webgl", "webgl", "webgl", "webgl", "webgl", "dom", "dom"]);
  expect(pool.live).toBe(6);
  choices[0].dispose();
  expect(pool.live).toBe(5);
  expect(attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool).mode).toBe("webgl");
  expect(pool.live).toBe(6);
});

test("a lost context frees its slot once, and a GPU failure counts nothing", () => {
  const pool = { max: 1, live: 0 };
  const gl = fakeWebgl();
  const first = attachRenderer({ loadAddon() {} }, () => gl, true, pool);
  expect(first.mode).toBe("webgl");
  gl.lose();
  gl.lose();
  first.dispose();
  expect(pool.live).toBe(0);
  const broken = attachRenderer({ loadAddon() { throw new Error("no gl"); } }, fakeWebgl, true, pool);
  expect(broken.mode).toBe("dom");
  expect(pool.live).toBe(0);
});

test("glyph caches can be reset on the GPU path and the ask is harmless on the plain path", () => {
  let cleared = 0;
  const gl = Object.assign(fakeWebgl(), { clearTextureAtlas: () => void cleared++ });
  const gpu = attachRenderer({ loadAddon() {} }, () => gl);
  gpu.clearGlyphs();
  expect(cleared).toBe(1);
  const plain = attachRenderer({ loadAddon() {} }, fakeWebgl, false);
  expect(() => plain.clearGlyphs()).not.toThrow();
});

test("the GPU setting defaults on and can be forced off", () => {
  expect(gpuOn({})).toBe(true);
  expect(gpuOn({ [GPU_FIELD]: true })).toBe(true);
  expect(gpuOn({ [GPU_FIELD]: false })).toBe(false);
});

test("a heartbeat that skips far ahead means the machine slept: the glyph caches are reset once", () => {
  let now = 1_000_000;
  let resumed = 0;
  const w = watchResume(() => resumed++, () => now, 30_000);
  now += 5_000;
  w.tick();
  now += 5_000;
  w.tick();
  expect(resumed).toBe(0);
  now += 90_000;
  w.tick();
  expect(resumed).toBe(1);
  now += 5_000;
  w.tick();
  expect(resumed).toBe(1);
});
