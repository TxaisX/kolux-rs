import { expect, test } from "vitest";
import { inTurn } from "./useSettings";

test("settings saves run one at a time, so a quick second save cannot drop the first", async () => {
  let disk: Record<string, unknown> = {};
  const tick = () => new Promise((r) => setTimeout(r, 5));
  // Read, wait, then write: two of these at once would lose a field.
  const save = inTurn(async (patch: Record<string, unknown>) => {
    const read = { ...disk };
    await tick();
    disk = { ...read, ...patch };
  });
  await Promise.all([save({ branchPrefixCustom: "feat" }), save({ refreshBaseFirst: true })]);
  expect(disk).toEqual({ branchPrefixCustom: "feat", refreshBaseFirst: true });
  // A failed save does not block the next one.
  const flaky = inTurn(async (fail: boolean) => {
    if (fail) throw new Error("no");
    return "ok";
  });
  await expect(flaky(true)).rejects.toThrow("no");
  await expect(flaky(false)).resolves.toBe("ok");
});
