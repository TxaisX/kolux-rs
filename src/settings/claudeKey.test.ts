import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { keyCard, monthYear, type KeyStatus } from "./claudeKey";
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

test("a failed setup shows its reason and lets the user connect again", () => {
  const c = keyCard({ ...off, attention: "The installed Claude launcher (claude.cmd) is a script wrapper Kolux cannot start directly." });
  expect(c.state).toBe("attention");
  expect(c.detail).toContain("claude.cmd");
  expect(c.actions).toEqual(["connect"]);
  expect(keyCard(off).actions).toEqual(["connect"]);
});

test("the card renders the buttons its state offers", () => {
  const html = renderToString(createElement(ClaudeCardView, { status: made(340, 25, true), busy: false, onAction: () => {} }));
  expect(html).toContain("Renew");
  expect(html).toContain("Disconnect");
  expect(html).toContain('data-state="warning"');
});
