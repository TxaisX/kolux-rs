import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { GrokCardView, GrokKeyDialog, grokHeadline, grokState, type GrokView } from "./GrokCard";
import { CodexCardView, codexState, type CodexView } from "./CodexCard";
import { ClaudeCardView } from "./SettingsPage";
import type { KeyStatus } from "./claudeKey";
import { PENDING_MS, settleWithin } from "./pending";

const off: GrokView = { connection: "none", signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null };
const html = (view: GrokView, pending: "connect" | null = null) => renderToString(createElement(GrokCardView, { view, pending, onAction: () => {} }));
const refused = { reason: "sign-in-refused" as const, message: "Grok's sign-in ended without signing in: expired", resetsAt: null };

test("signed out, Grok offers Connect and two other ways, the key one marked advanced and pay-per-use", () => {
  const h = html(off);
  expect(h).toContain("Not connected");
  expect(h).toContain(">Connect<");
  expect(h).toContain("Other ways to connect");
  expect(h).toContain("Sign in with a code");
  expect(h).toContain("Use an xAI API key (advanced, pay-per-use)");
  expect(h).not.toContain(">Cancel<");
});

test("a CLI sign-in wins over a saved key, and an existing sign-in is connected with nothing to do", () => {
  expect(grokHeadline({ ...off, connection: "cli" })).toBe("Connected · Grok sign-in");
  expect(grokHeadline({ ...off, connection: "key" })).toContain("pay-per-use");
  const h = html({ ...off, connection: "cli" });
  expect(h).toContain("Connected");
  for (const b of [">Connect<", ">Cancel<", "Other ways to connect"]) expect(h).not.toContain(b);
});

test("connecting shows exactly one state with Cancel, and the device code only once both parts are known", () => {
  const browser = { ...off, signingIn: "browser" as const, inBrowser: true };
  expect(grokState(browser)).toBe("connecting");
  expect(html(browser)).toContain("xAI page that opened");
  expect(html(browser)).toContain(">Cancel<");
  expect(html(browser)).not.toContain(">Connect<");
  const waiting = { ...off, signingIn: "device" as const, deviceLink: "https://accounts.x.ai/oauth2/device?user_code=8EMT-BJ57" };
  expect(html(waiting)).not.toContain("accounts.x.ai");
  const both = { ...waiting, deviceCode: "8EMT-BJ57" };
  expect(html(both)).toContain("8EMT-BJ57");
  expect(html(both)).toContain(">Cancel<");
});

test("a failed sign-in needs attention with its one fix and a Cancel that wipes it", () => {
  const v = { ...off, attention: refused };
  expect(grokState(v)).toBe("attention");
  const h = html(v);
  expect(h).toContain("Needs attention");
  expect(h).toContain("Try again");
  expect(h).toContain(">Cancel<");
  expect(h).not.toContain(">Connect<");
});

test("each connect choice is greyed out while its request is pending", () => {
  const h = html(off, "connect");
  expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Connect</);
  expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Sign in with a code</);
});

test("a pending request lets go after 30 seconds if no answer arrives", async () => {
  vi.useFakeTimers();
  let done = false;
  void settleWithin(new Promise(() => {})).then(() => (done = true));
  await vi.advanceTimersByTimeAsync(PENDING_MS - 1);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(done).toBe(true);
  vi.useRealTimers();
  // an answer (even a refusal) releases it at once
  await settleWithin(Promise.reject(new Error("no")));
});

test("the key dialog's Connect is disabled until something is typed, and the field starts blank", () => {
  const h = renderToString(createElement(GrokKeyDialog, { open: true, onSubmit: () => {}, onClose: () => {} }));
  expect(h).toContain('type="password"');
  expect(h).toContain("Advanced. xAI bills an API key per use");
  expect(h).toMatch(/<button type="submit"[^>]*disabled=""/);
  expect(h).toContain('value=""');
});

test("Codex says needs attention after a failed sign-in, with a Cancel that wipes it", () => {
  const cx: CodexView = { accounts: [], active: null, systemDefault: "signed-out", signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: refused, drifted: [] };
  expect(codexState(cx)).toBe("attention");
  const h = renderToString(createElement(CodexCardView, { view: cx, onAction: () => {} }));
  expect(h).toContain("Needs attention");
  expect(h).toContain(">Cancel<");
  expect(codexState({ ...cx, attention: null })).toBe("disconnected");
});

test("seven ways to connect exist across the three cards (ACCT-002 compat)", () => {
  const claudeOff: KeyStatus = { connected: false, createdAt: null, expiresAt: null, daysLeft: null, renewDue: false, expired: false, settingUp: false, inBrowser: false, attention: null };
  const claude = renderToString(createElement(ClaudeCardView, { status: claudeOff, busy: false, onAction: () => {}, onUseAccount: () => {} }));
  const codex = renderToString(createElement(CodexCardView, { view: { accounts: [], active: null, systemDefault: "signed-out", signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null, drifted: [] }, onAction: () => {} }));
  const grok = html(off);
  const ways = [
    [claude, ">Connect<"], // Claude by 1-year key (the default)
    [claude, "Use my Claude account instead"],
    [codex, ">Connect<"], // Codex by ChatGPT sign-in (the default)
    [codex, "Sign in with a code"],
    [grok, ">Connect<"], // Grok by its CLI login (the default)
    [grok, "Sign in with a code"],
    [grok, "Use an xAI API key"],
  ];
  for (const [card, way] of ways) expect(card).toContain(way);
  for (const card of [claude, codex, grok]) expect(card).toContain("Other ways to connect");
});
