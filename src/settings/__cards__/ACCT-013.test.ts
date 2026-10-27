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

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");

test("box 1: the card the back end sends for a refused key shows key expired with Renew, and no other fix", () => {
  // evidence/cards-ACCT-013-key-expired.json is what cards_07.rs acct013_box1 compares the real claude_key status to.
  const status = JSON.parse(nodeFs.readFileSync(new URL("../../../evidence/cards-ACCT-013-key-expired.json", import.meta.url), "utf8")) as KeyStatus;
  expect(status.attention?.reason).toBe("key-expired");
  expect(fixFor(status.attention, "claude-key")).toBe("Renew");
  const h = renderToString(createElement(ClaudeCardView, { status, busy: false, onAction: () => {} }));
  expect(h).toContain('data-reason="key-expired"');
  expect(h).toContain(">Renew<");
  for (const fix of ["Check again", "Try installing again", "Open install page", "Try again", "Use a 1-year key instead"]) expect(h).not.toContain(`>${fix}<`);
});
