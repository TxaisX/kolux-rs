// SESS-024 box 2: one of four launched panes fails to start and is dropped, leaving three.
import { expect, test } from "vitest";
import { withoutFailed } from "../seats";

test("SESS-024 box 2: of four seat panes one fails -> three panes remain, none is a blank stand-in, the lineup is not 'nothing started'", () => {
  const batch = 9;
  const panes = [1, 2, 3, 4].map((key) => ({ key, batch, title: `Seat ${key}` }));
  const after = withoutFailed(panes, 3);
  expect(after.panes).toHaveLength(3);
  expect(after.panes.map((p) => p.key)).toEqual([1, 2, 4]);
  expect(after.panes.every((p) => p.title.startsWith("Seat"))).toBe(true);
  expect(after.batchEmpty).toBe(false);
});
