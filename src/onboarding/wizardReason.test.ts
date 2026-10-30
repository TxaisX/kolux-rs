import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { WizardView } from "./Wizard";
import { EN } from "../i18n/en";

const view = (at: number, more: Record<string, unknown> = {}) =>
  renderToString(createElement(WizardView, { at, connected: false, ping: true, hooks: true, onHooks() {}, onPing() {}, onBack() {}, onMain() {}, onSecondary() {}, onPickFolder() {}, ...more }));

test("ONB-003 UX fix 3: a greyed-out Continue on the connect screen says why and names the way on", () => {
  const off = view(1);
  expect(off).toMatch(/<button[^>]*disabled=""[^>]*>Continue/);
  expect(off).toContain('class="onb-gap onb-why"');
  expect(off).toContain(EN["onboarding.connect.wait"]);
  expect(EN["onboarding.connect.wait"]).toContain("I’ll do this later");
});

test("ONB-003 UX fix 3: no reason once an AI is connected, and none on other screens", () => {
  expect(view(1, { connected: true })).not.toContain("onb-why");
  expect(view(0)).not.toContain("onb-why");
  expect(view(2)).not.toContain("onb-why");
});
