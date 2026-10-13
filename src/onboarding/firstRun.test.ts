import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { chordFires, kitLaunch, openAt, SCREENS } from "./firstRun";
import { WizardView } from "./Wizard";
import { jargon } from "../glossary";

const view = (at: number, more: Record<string, unknown> = {}) =>
  renderToString(createElement(WizardView, { at, connected: false, sample: "spreadsheet", busy: false, kit: "spreadsheet", ping: true, vendors: [], error: null, onSample() {}, onKit() {}, onPing() {}, onBack() {}, onMain() {}, onSecondary() {}, onPickFolder() {}, ...more }));

test("ONB-001: the wizard opens after the last screen it finished, within the four", () => {
  expect(SCREENS.map((s) => s.id)).toEqual(["welcome", "connect", "work", "kit"]);
  expect(openAt(null)).toBeNull();
  expect(openAt({ step: -1 })).toBe(0);
  expect(openAt({ step: 1 })).toBe(2);
  expect(openAt({ step: 3 })).toBe(3);
  expect(openAt({ step: 7 })).toBe(3);
});

test("ONB-001: Ctrl+Enter fires the main button, never from a text field, mid-composition or while it is off", () => {
  const key = (over: Record<string, unknown> = {}) => ({ key: "Enter", ctrlKey: true, metaKey: false, isComposing: false, target: null, ...over });
  expect(chordFires(key(), false)).toBe(true);
  expect(chordFires(key({ ctrlKey: false, metaKey: true }), false)).toBe(true);
  expect(chordFires(key({ ctrlKey: false }), false)).toBe(false);
  expect(chordFires(key(), true)).toBe(false);
  expect(chordFires(key({ isComposing: true }), false)).toBe(false);
  expect(chordFires(key({ target: { tagName: "TEXTAREA" } }), false)).toBe(false);
  expect(chordFires(key({ target: { tagName: "INPUT", type: "text" } }), false)).toBe(false);
  expect(chordFires(key({ target: { tagName: "INPUT", type: "checkbox" } }), false)).toBe(true);
  expect(chordFires(key({ target: { tagName: "DIV", isContentEditable: true } }), false)).toBe(false);
  expect(chordFires(key({ key: "a" }), false)).toBe(false);
});

test("ONB-001 / ONB-002: screen one of four, its bars, no Back, three AI tiles and Get started", () => {
  const html = view(0);
  expect(html).toContain("1 of 4");
  expect(html.match(/class="onb-bar[^"]*"/g)).toEqual(['class="onb-bar now"', 'class="onb-bar"', 'class="onb-bar"', 'class="onb-bar"']);
  expect(html).toContain('title="Connect an AI"');
  expect(html).not.toContain(">Back<");
  for (const ai of ["Claude", "Codex", "Grok"]) expect(html).toContain(`aria-label="${ai} at work"`);
  expect(html.match(/onb-dot/g)?.length).toBe(3);
  expect(html).toMatch(/<button[^>]*class="btn primary onb-main"[^>]*>Get started<span class="onb-chord">/);
  expect(html).toContain("data-tauri-drag-region");
});

test("ONB-003: Continue waits for a connected AI; I'll do this later always moves on; Back shows", () => {
  const off = view(1, { cards: createElement("div", { className: "cards-here" }) });
  expect(off).toContain("2 of 4");
  expect(off).toContain('class="onb-bar done"');
  expect(off).toContain(">Back<");
  expect(off).toContain("cards-here");
  expect(off).toMatch(/<button[^>]*disabled=""[^>]*>Continue/);
  expect(off).toMatch(/<button class="btn onb-secondary"[^>]*>I’ll do this later<\/button>/);
  expect(view(1, { connected: true })).not.toMatch(/<button[^>]*disabled=""[^>]*>Continue/);
});

test("ONB-004: the spreadsheet sample is chosen, Pick a folder is the other route, Continue is busy while it works", () => {
  const html = view(2);
  expect(html).toContain("Pick a folder");
  expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
  expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="Analyse a spreadsheet"|aria-label="Analyse a spreadsheet"[^>]*aria-pressed="true"/);
  expect(html.match(/class="onb-sample"/g)?.length).toBe(6);
  expect(html).toMatch(/>Try with sample data<span/);
  const busy = view(2, { busy: true, error: "the disk is full" });
  expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>Setting up…/);
  expect(busy).toContain("the disk is full");
});

test("ONB-005: kit cards with their roles, the finish switch on, Start kit and Just open a session", () => {
  const html = view(3, { kit: "sales", vendors: ["claude"] });
  expect(html).toContain("4 of 4");
  expect(html).toMatch(/aria-label="Build a sales follow-up list"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Build a sales follow-up list"/);
  expect(html).toContain("Lead scorer");
  expect(html).toMatch(/<input type="checkbox" role="switch" checked=""/);
  expect(html).toMatch(/>Start kit<span/);
  expect(html).toContain(">Just open a session<");
  expect(view(3, { ping: false })).not.toMatch(/role="switch" checked=""/);
});

test("ONB-005: Start kit launches at once only in the kit's own sample folder with an AI ready", () => {
  const sample = "C:\\samples\\spreadsheet";
  expect(kitLaunch(sample, sample, ["claude"])).toBe("launch");
  expect(kitLaunch("c:/samples/spreadsheet/", sample, ["codex"])).toBe("launch");
  expect(kitLaunch(sample, sample, [])).toBe("setup");
  expect(kitLaunch("C:\\work\\shop", sample, ["claude"])).toBe("setup");
  expect(kitLaunch(null, sample, ["claude"])).toBe("setup");
  expect(kitLaunch(sample, null, ["claude"])).toBe("setup");
});

test("ONB-036: the wizard's own words keep to plain words", () => {
  for (const at of [0, 1, 2, 3]) {
    const text = view(at).replace(/<[^>]+>/g, " ");
    expect(jargon(text)).toEqual([]);
  }
});
