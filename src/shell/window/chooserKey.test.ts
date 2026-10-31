// Cycle 3 review (blocker): the New session sheet's chooser must be a fresh instance per sheet.
// Before the WindowView split the chooser was rendered with key={p.key}; the split dropped it, so a
// second sheet reused the first one's React state (the team-name field, the open menu, the install
// error, the shown/nudged flags) instead of starting clean. React treats a changed key on a single
// child as a different element and remounts it, so the guard is the key itself; this test fails when
// it goes missing again.
import { expect, test } from "vitest";
import seat from "./SeatChooser.tsx?raw";
import content from "./Content.tsx?raw";

test("the chooser is keyed by its pane, so a second sheet starts clean", () => {
  const element = /<ChooserPane\b[\s\S]*?\/>/.exec(seat)?.[0] ?? "";
  expect(element, "SeatChooser renders ChooserPane").not.toBe("");
  expect(element, "the chooser carries key={p.key}").toMatch(/\bkey=\{p\.key\}/);
});

test("the sheet and the grid both render that one chooser, so neither can lose the key", () => {
  expect(content).toContain("<SeatChooser");
  expect(content, "the sheet passes the pane it is for").toMatch(/<SeatChooser\s+pane=\{/);
});
