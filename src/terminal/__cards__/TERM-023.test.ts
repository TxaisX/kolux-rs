// TERM-023 acceptance: a pane that finished unseen reads Done with its age and glows (static); focusing it clears the glow.
// The glow is the pane's `glow` class: set by the unread mark (marksUnread) or by the ended-while-away effect in TerminalPane.
import { expect, test } from "vitest";
import { toAcknowledge } from "../../notify/seen";
import { ageLabel, headerOf } from "../status";
import { marksUnread } from "../tabs";

// the stylesheet is stripped from imports under vitest, so it is read from disk (no node types in tsc: dynamic specifier)
const fsName = "node:fs";
const css: string = ((await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, e: string) => string }).readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

test("box 1: a pane that finished 3 minutes ago, unseen, reads Done with 3m and carries the glow class", () => {
  const finished = 1_000_000;
  const now = finished + 3 * 60_000 + 5_000;
  expect(headerOf("claude", "running", undefined, false, finished, now, "done")).toMatchObject({ word: "Done", tone: "done", age: "3m ago" });
  expect(ageLabel(finished, finished + 59_000)).toBe("just now");
  // unseen: the pane is not the one in view, so the finish marks it unread (useAgentStatus.ts:180)
  const unread = marksUnread(7, new Set([7, 8]), new Set(), false, true);
  expect(unread).toBe(true);
  // MIRROR TerminalPane.tsx:1477: className `pane...${glow || unread ? " glow" : ""}`
  const glow = false;
  expect(glow || unread).toBe(true);
  // the glow is green, soft and static: no animation or transition on it
  const rule = css.match(/^\.pane\.glow \{[^}]*\}/m)?.[0] ?? "";
  expect(rule).toContain("var(--done)");
  expect(rule).toContain("rgba(1, 200, 143, 0.3)");
  expect(rule).not.toMatch(/animation|transition/);
  expect(css).not.toMatch(/@keyframes [\w-]*glow/);
});

test("box 2: focusing the pane clears its unread mark, so the glow class goes", () => {
  const unread = new Set([7]);
  const stamp = (k: number) => (k === 7 ? 3 : undefined);
  // another pane has focus: the mark stays
  expect(toAcknowledge({ unread, inView: (k) => k === 8, focused: true, manual: new Set(), stampOf: stamp, acked: new Set() }).panes).toEqual([]);
  // the user clicks into pane 7: it is in view in a focused window, the mark clears (useAgentStatus.ts:325-328)
  const seen = toAcknowledge({ unread, inView: (k) => k === 7, focused: true, manual: new Set(), stampOf: stamp, acked: new Set() }).panes;
  expect(seen).toEqual([7]);
  const left = new Set([...unread].filter((k) => !seen.includes(k)));
  expect(left.has(7)).toBe(false); // glow || unread is now false
});
