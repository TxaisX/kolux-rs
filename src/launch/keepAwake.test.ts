// TERM-122: keep-awake is Off by default, an older plain on reads as Agent, and the status bar
// item shows only while the computer is being kept awake.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import KeepAwakeCard, { awakeMode, KeepAwakeItem } from "./KeepAwakeCard";

test("off by default; an older plain on reads as Agent; anything unknown is off", () => {
  expect(awakeMode({})).toBe("off");
  expect(awakeMode(null)).toBe("off");
  expect(awakeMode({ keepAwake: true })).toBe("agent");
  expect(awakeMode({ keepAwake: false })).toBe("off");
  expect(awakeMode({ keepAwake: "on" })).toBe("on");
  expect(awakeMode({ keepAwake: "nope" })).toBe("off");
});

test("the Settings card offers On, Agent and Off, picks the saved one and explains the lid", () => {
  const fresh = renderToString(createElement(KeepAwakeCard, { settings: {}, save: () => {} }));
  for (const label of ["Off", "Agent", "On"]) expect(fresh).toContain(`>${label}</option>`);
  expect(fresh).toMatch(/<option value="off" selected="">Off/);
  expect(fresh).toContain("Closing the lid still follows the system");
  const agent = renderToString(createElement(KeepAwakeCard, { settings: { keepAwake: true }, save: () => {} }));
  expect(agent).toMatch(/<option value="agent" selected="">Agent/);
  expect(agent).toContain("while an agent is working");
  // an agent typed into a shell pane ends with the shell, not with the agent: say how long it can count
  expect(agent).toContain("at most 30 minutes after its last word");
  // Microsoft warns that a continuous hold drains a Modern Standby laptop even with the lid closed
  const on = renderToString(createElement(KeepAwakeCard, { settings: { keepAwake: "on" }, save: () => {} }));
  expect(on).toContain("drains the battery even with the lid closed");
});

test("the status bar item shows only while the computer is kept awake", () => {
  const shown = renderToString(createElement(KeepAwakeItem, { held: true }));
  expect(shown).toContain("Awake");
  // the bar styles its items by the `item` class; an unstyled class would draw it bare
  expect(shown).toMatch(/^<span class="item" data-item="keep-awake"/);
  expect(renderToString(createElement(KeepAwakeItem, { held: false }))).toBe("");
});
