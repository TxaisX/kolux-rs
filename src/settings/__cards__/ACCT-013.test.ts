// ACCT-013 box 2: the Claude card on a usage limit. The reset time is the one the back end sends
// (src-tauri/tests/cards_07.rs acct013_box2: reason "usage-limit", resetsAt in ms).
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { fixFor } from "../Attention";
import type { KeyStatus } from "../claudeKey";
import { ClaudeCardView } from "../SettingsPage";

const DAY = 86_400_000;
const off: KeyStatus = { connected: false, createdAt: null, expiresAt: null, daysLeft: null, renewDue: false, expired: false, settingUp: false, inBrowser: false, attention: null };

test("box 2: a usage limit shows when Claude can be used again and offers no fix button", () => {
  const resetsAt = new Date(2026, 9, 26, 15, 40).getTime();
  const now = new Date(2026, 9, 26, 12, 0).getTime();
  const attention = { reason: "usage-limit" as const, message: "Claude's usage limit was reached.", resetsAt };
  expect(fixFor(attention, "claude-key")).toBeNull();
  for (const status of [
    { ...off, connected: true, createdAt: now - 10 * DAY, expiresAt: now + 355 * DAY, daysLeft: 355, attention }, // key mode
    { ...off, attention }, // not connected by key
  ]) {
    const h = renderToString(createElement(ClaudeCardView, { status, busy: false, onAction: () => {} }));
    expect(h).toContain("It can be used again at");
    expect(h).toMatch(/3:40|15:40/);
    expect(h).toContain('data-reason="usage-limit"');
    for (const fix of ["Renew", "Check again", "Try installing again", "Open install page", "Try again", "Use a 1-year key instead"]) expect(h).not.toContain(`>${fix}<`);
  }
});
