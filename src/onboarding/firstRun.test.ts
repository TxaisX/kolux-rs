import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { CHECKLIST_CHANGED, chordFires, clearReadFailure, closer, readFailed, connectFailed, firstAiConnected, firstConnection, firstFolderAgent, kitLaunch, leaveKey, milestone, oneClick, openAt, reopenWizard, SCREENS, STATUSES_FAILED, wizardCloser, type Outcome } from "./firstRun";
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

test("ONB-006: Escape asks to leave, but not mid-composition or once something inside handled it", () => {
  const esc = (over: Record<string, unknown> = {}) => ({ key: "Escape", isComposing: false, defaultPrevented: false, ...over });
  expect(leaveKey(esc())).toBe(true);
  expect(leaveKey(esc({ isComposing: true }))).toBe(false);
  expect(leaveKey(esc({ defaultPrevented: true }))).toBe(false);
  expect(leaveKey(esc({ key: "Enter" }))).toBe(false);
});

test("ONB-006: the leave question offers Skip and No, keep going, and names the help menu's Onboarding item", () => {
  const html = view(1, { leaving: true, onSkip() {}, onStay() {} });
  expect(html).toContain("Skip setup?");
  expect(html).toContain(">Skip<");
  expect(html).toContain(">No, keep going<");
  expect(html).toContain("Onboarding");
  expect(html).toContain("help menu");
  expect(view(1)).not.toContain("Skip setup?");
  expect(jargon(html)).toEqual([]);
});

test("ONB-007: a close is latched while it stores; a failed store frees it and the next click retries it", async () => {
  const calls: Outcome[] = [];
  let fails = 1;
  let release: () => void = () => {};
  const store = (o: Outcome) => {
    calls.push(o);
    return new Promise<void>((ok, no) => (release = () => (fails-- > 0 ? no(new Error("disk full")) : ok())));
  };
  const seen: string[] = [];
  const c = closer(store, () => seen.push("closed"), (err) => seen.push(String(err)));
  const flush = () => new Promise((r) => setTimeout(r, 0));
  expect(c.retry()).toBe(false);
  c.end("completed", () => seen.push("after"));
  c.end("dismissed");
  expect(calls).toEqual(["completed"]);
  release();
  await flush();
  expect(seen).toEqual(["Error: disk full"]);
  expect(c.retry()).toBe(true);
  expect(calls).toEqual(["completed", "completed"]);
  release();
  await flush();
  expect(seen).toEqual(["Error: disk full", "closed", "after"]);
  expect(c.retry()).toBe(false);
});

test("ONB-010: the first folder starts only the saved default agent, never a guess", () => {
  const agents = [
    { id: "claude", installed: true },
    { id: "codex", installed: false },
  ];
  expect(firstFolderAgent(agents, "claude")?.id).toBe("claude");
  expect(firstFolderAgent(agents, "")).toBeNull();
  expect(firstFolderAgent(agents, "terminal")).toBeNull();
  expect(firstFolderAgent(agents, "codex")).toBeNull();
  expect(firstFolderAgent(agents, "grok")).toBeNull();
});

test("ONB-009: clicks on Onboarding less than half a second apart count as one", () => {
  const click = oneClick();
  expect([click(1000), click(1300), click(1700), click(2300), click(2799), click(3300)]).toEqual([true, false, false, true, false, true]);
});

test("ONB-011: a milestone goes to onboarding.rs by name, and a failed write shows nothing", async () => {
  const sent: unknown[] = [];
  await expect(milestone("aiConnected", async (cmd, args) => void sent.push([cmd, args]))).resolves.toBe(true);
  expect(sent).toEqual([["onboarding_milestone", { name: "aiConnected" }]]);
  // FIX-3: the answer says whether the write landed (no throw, nothing shown), so a caller can retry.
  await expect(milestone("kitLaunched", () => Promise.reject(new Error("disk full")))).resolves.toBe(false);
});

test("ACCT-035: a failed connect names the agent it was for, in plain words", () => {
  expect(connectFailed("Grok", new Error("the sign-in window was closed"))).toBe("Grok could not connect: the sign-in window was closed");
  expect(connectFailed("Codex", "Error: timed out")).toBe("Codex could not connect: timed out");
  expect(connectFailed("Claude", undefined)).toBe("Claude could not connect. Try again in a moment.");
  expect(connectFailed("Grok", "")).toMatch(/^Grok /);
  expect(jargon(connectFailed("Grok", "x") + STATUSES_FAILED)).toEqual([]);
  expect(STATUSES_FAILED.length).toBeGreaterThan(0);
});

test("ACCT-035 (FIX-2 R3): the statuses-failed text names only the re-read on coming back, never a retry timer or a Check again button the alert lacks", () => {
  // The cards re-read on window focus and an agents event; Check again shows only for some states.
  expect(STATUSES_FAILED).not.toMatch(/on its own|few seconds|automatic/i);
  expect(STATUSES_FAILED).toMatch(/come back to this window/i);
  expect(STATUSES_FAILED).not.toMatch(/Check again/i);
  expect(jargon(STATUSES_FAILED)).toEqual([]);
});

test("ACCT-035 (FIX-2 R3): a good read clears only the read-failure line and keeps a connect failure", () => {
  expect(clearReadFailure(STATUSES_FAILED)).toBeNull();
  expect(clearReadFailure(null)).toBeNull();
  const connect = connectFailed("Codex", "network down");
  expect(clearReadFailure(connect)).toBe(connect);
  // The cards pass it to their error setter as an updater: a failed read, then a good one, leaves nothing.
  let error: string | null = null;
  const setError = (v: string | null | ((e: string | null) => string | null)) => void (error = typeof v === "function" ? v(error) : v);
  setError(STATUSES_FAILED);
  setError(clearReadFailure);
  expect(error).toBeNull();
  setError(connect);
  setError(clearReadFailure);
  expect(error).toBe(connect);
});

test("VIEW-114 (FIX-2 FB1): a stored wizard close hides the wizard, then tells the sidebar its record changed; a failed close tells it nothing", async () => {
  const seen: string[] = [];
  let ok = false;
  const store = () => (ok ? Promise.resolve() : Promise.reject(new Error("disk full")));
  const c = wizardCloser(store, () => seen.push("hidden"), (err) => seen.push(String(err)), () => seen.push(CHECKLIST_CHANGED));
  const flush = () => new Promise((r) => setTimeout(r, 0));
  c.end("dismissed");
  await flush();
  expect(seen).toEqual(["Error: disk full"]);
  ok = true;
  expect(c.retry()).toBe(true);
  await flush();
  expect(seen).toEqual(["Error: disk full", "hidden", CHECKLIST_CHANGED]);
});

test("VIEW-114 (FIX-2 FB1): a stored reopen shows screen one, then tells the sidebar; a failed reopen only reports", async () => {
  const seen: string[] = [];
  await reopenWizard(() => Promise.reject(new Error("locked")), () => seen.push("shown"), (err) => seen.push(String(err)), () => seen.push(CHECKLIST_CHANGED));
  expect(seen).toEqual(["Error: locked"]);
  await reopenWizard(() => Promise.resolve(), () => seen.push("shown"), (err) => seen.push(String(err)), () => seen.push(CHECKLIST_CHANGED));
  expect(seen).toEqual(["Error: locked", "shown", CHECKLIST_CHANGED]);
});

// FIX-4: the useWizard wiring (close, reopen, added project) is tested through the real hook in useWizard.test.ts.

test("ACCT-035: the first connected report sends the first-AI milestone once; not-connected reports send nothing", () => {
  const sent: string[] = [];
  const report = firstConnection(async (n) => (sent.push(n), true));
  report(false);
  report(false);
  expect(sent).toEqual([]);
  report(true);
  report(false);
  report(true);
  expect(sent).toEqual(["aiConnected"]);
  expect(typeof firstAiConnected).toBe("function");
});

test("ACCT-035 (FIX-3): a first-AI write that fails is sent again on the next connected report (in the app: the next page visit or connection change); one that lands is never sent again", async () => {
  const tries: boolean[] = [];
  let works = false;
  const report = firstConnection(async () => (tries.push(works), works));
  report(true);
  await Promise.resolve();
  await Promise.resolve();
  report(true);
  await Promise.resolve();
  expect(tries).toEqual([false, false]);
  works = true;
  report(false);
  await Promise.resolve();
  report(true);
  await Promise.resolve();
  await Promise.resolve();
  report(true);
  report(true);
  await Promise.resolve();
  expect(tries).toEqual([false, false, true]);
});

test("ACCT-035 (FIX-3): a failed read never replaces a connect failure the user has not seen out; it fills an empty line or its own", () => {
  const connect = connectFailed("Codex", new Error("the sign-in window was closed"));
  expect(readFailed(connect)).toBe(connect);
  expect(readFailed(null)).toBe(STATUSES_FAILED);
  expect(readFailed(STATUSES_FAILED)).toBe(STATUSES_FAILED);
  expect(readFailed("")).toBe(STATUSES_FAILED);
  // The full round: connect fails, the settle read fails too, then a good read clears only the read line.
  let e: string | null = null;
  const setError = (f: string | null | ((x: string | null) => string | null)) => (e = typeof f === "function" ? f(e) : f);
  setError(connect);
  setError(readFailed);
  expect(e).toBe(connect);
  setError(clearReadFailure);
  expect(e).toBe(connect);
  setError(null);
  setError(readFailed);
  setError(clearReadFailure);
  expect(e).toBeNull();
});
