// ACCT-004 acceptance, the card half. The figures below are the JSON the back end sends for a key kept
// by claude_key::keep (src-tauri/tests/cards_07.rs acct004_box1, acct004_box2 assert these same values);
// the key itself never reaches the window, and the one used here is not a key.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { keyCard, monthYear, type KeyStatus } from "../claudeKey";
import { ClaudeCardView } from "../SettingsPage";

const DAY = 86_400_000;
const now = new Date(2026, 9, 26, 12, 0).getTime();
const off: KeyStatus = { connected: false, createdAt: null, expiresAt: null, daysLeft: null, renewDue: false, expired: false, settingUp: false, inBrowser: false, attention: null };
const html = (status: KeyStatus) => renderToString(createElement(ClaudeCardView, { status, busy: false, onAction: () => {} }));

test("box 1: a freshly kept key reads connected and names the month a year ahead, with nothing to renew yet", () => {
  const status: KeyStatus = { ...off, connected: true, createdAt: now, expiresAt: now + 365 * DAY, daysLeft: 365, renewDue: false, expired: false };
  const card = keyCard(status);
  expect(card.state).toBe("connected");
  expect(card.headline).toBe("Connected · 1-year key");
  expect(card.detail).toContain(`Renew in ${monthYear(now + 365 * DAY)}`);
  expect(monthYear(now + 365 * DAY)).toMatch(/2027/);
  expect(card.actions).toEqual(["disconnect"]);
  const h = html(status);
  expect(h).toContain('data-state="connected"');
  expect(h).not.toContain(">Connect<");
});

test("box 2: a key made 340 days ago shows the expiry warning and Renew", () => {
  const status: KeyStatus = { ...off, connected: true, createdAt: now - 340 * DAY, expiresAt: now + 25 * DAY, daysLeft: 25, renewDue: true, expired: false };
  const card = keyCard(status);
  expect(card.state).toBe("warning");
  expect(card.detail).toContain("25 days");
  expect(card.actions).toContain("renew");
  const h = html(status);
  expect(h).toContain('data-state="warning"');
  expect(h).toContain(">Renew<");
});
