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
});

test("the status bar item shows only while the computer is kept awake", () => {
  expect(renderToString(createElement(KeepAwakeItem, { held: true }))).toContain("Awake");
  expect(renderToString(createElement(KeepAwakeItem, { held: false }))).toBe("");
});
