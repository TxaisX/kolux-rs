import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { keyCard, monthYear, ownSignInLine, resumeOn, type KeyStatus } from "./claudeKey";
import { ClaudeCardView } from "./SettingsPage";

const DAY = 86_400_000;
const now = new Date(2026, 9, 9, 12, 0).getTime();
const off: KeyStatus = { connected: false, createdAt: null, expiresAt: null, daysLeft: null, renewDue: false, expired: false, settingUp: false, inBrowser: false, attention: null };
const made = (daysAgo: number, daysLeft: number, renewDue: boolean, expired = false): KeyStatus => ({
  ...off,
  connected: true,
  createdAt: now - daysAgo * DAY,
  expiresAt: now - daysAgo * DAY + 365 * DAY,
  daysLeft,
  renewDue,
  expired,
});

test("a fresh key names the renewal month about a year ahead and offers only Disconnect", () => {
  const c = keyCard(made(0, 365, false));
  expect(c.state).toBe("connected");
  expect(c.detail).toContain(monthYear(now + 365 * DAY));
  expect(c.detail).toContain("2027");
  expect(c.actions).toEqual(["disconnect"]);
});

test("a key made 340 days ago warns with the days left and offers Renew", () => {
  const c = keyCard(made(340, 25, true));
  expect(c.state).toBe("warning");
  expect(c.detail).toContain("25 days");
  expect(c.actions).toContain("renew");
});

test("a key past its year reads ran out, still with Renew", () => {
  const c = keyCard(made(370, 0, true, true));
  expect(c.state).toBe("expired");
  expect(c.actions[0]).toBe("renew");
});

test("a running setup says to finish in the browser once the page is open, with Cancel", () => {
  expect(keyCard({ ...off, settingUp: true }).headline).toMatch(/Starting/);
  const c = keyCard({ ...off, settingUp: true, inBrowser: true });
  expect(c.headline).toBe("Finish in the browser");
  expect(c.actions).toEqual(["cancel"]);
});

test("a failed setup shows its reason with the one fix that fits (ACCT-013)", () => {
  const wrapper = { ...off, attention: { reason: "install-unavailable" as const, message: "The installed Claude launcher (claude.cmd) is a script wrapper Kolux cannot start directly.", resetsAt: null } };
  const c = keyCard(wrapper);
  expect(c.state).toBe("attention");
  expect(c.actions).toEqual(["cancel"]);
  const html = renderToString(createElement(ClaudeCardView, { status: wrapper, busy: false, onAction: () => {} }));
  expect(html).toContain("claude.cmd");
  expect(html).toContain("Open install page");
  expect(html).not.toContain(">Connect<");
  // an unknown reason is information only: the card keeps its own Connect and offers no fix
  const odd = { ...off, attention: { reason: "unknown" as const, message: "The key could not be stored: disk full", resetsAt: null } };
  expect(keyCard(odd).actions).toEqual(["connect", "cancel"]);
  const oddHtml = renderToString(createElement(ClaudeCardView, { status: odd, busy: false, onAction: () => {} }));
  for (const f of ["Try again", "Renew", "Check again", "Open install page"]) expect(oddHtml).not.toContain(f);
  expect(keyCard(off).actions).toEqual(["connect"]);
});

test("a usage limit shows when Claude can be used again, with no fix button", () => {
  const resetsAt = new Date(2026, 9, 9, 15, 40).getTime();
  const limited = { ...made(300, 65, false), attention: { reason: "usage-limit" as const, message: "Claude's usage limit was reached.", resetsAt } };
  expect(keyCard(limited).state).toBe("connected");
  const html = renderToString(createElement(ClaudeCardView, { status: limited, busy: false, onAction: () => {} }));
  expect(html).toContain("It can be used again at");
  expect(html).toContain('data-reason="usage-limit"');
  expect(html.match(/<button/g)?.length).toBe(1); // Disconnect only
});

test("the card renders the buttons its state offers", () => {
  const html = renderToString(createElement(ClaudeCardView, { status: made(340, 25, true), busy: false, onAction: () => {} }));
  expect(html).toContain("Renew");
  expect(html).toContain("Disconnect");
  expect(html).toContain('data-state="warning"');
});

test("Claude Code's own sign-in shows on the card only while it is what panes use, and a signed-out one warns (SET-030)", () => {
  expect(ownSignInLine(null)).toBeNull();
  expect(ownSignInLine({ state: "unknown", email: null })).toBeNull();
  expect(ownSignInLine({ state: "signed-in", email: "sam@example.com" })).toEqual({ text: "New Claude panes use Claude Code's own sign-in on this PC (sam@example.com).", warn: false });
  expect(ownSignInLine({ state: "signed-out", email: null })?.warn).toBe(true);
  const card = (own: Parameters<typeof ownSignInLine>[0], status: KeyStatus) => renderToString(createElement(ClaudeCardView, { status, busy: false, onAction: () => {}, own }));
  expect(card({ state: "signed-out", email: null }, off)).toContain("Claude Code is not signed in on this PC");
  expect(card({ state: "signed-out", email: null }, made(10, 355, false))).not.toContain("Claude Code is not signed in"); // the key is what panes use
});

test("resume after a usage limit is off unless turned on (SET-030, USAGE-007)", () => {
  expect(resumeOn({})).toBe(false);
  expect(resumeOn({ claudeResumeAfterLimit: "yes" })).toBe(false);
  expect(resumeOn({ claudeResumeAfterLimit: true })).toBe(true);
  const sw = (resume: boolean) => renderToString(createElement(ClaudeCardView, { status: off, busy: false, onAction: () => {}, resume, onResume: () => {} }));
  expect(sw(false)).toContain("Carry on by itself once a usage limit resets");
  expect(sw(false)).not.toContain("checked");
  expect(sw(true)).toContain("checked");
});
