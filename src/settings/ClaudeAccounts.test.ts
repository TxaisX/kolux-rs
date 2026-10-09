import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { ClaudeAccountsView, type AccountsView } from "./ClaudeAccounts";
import { ClaudeCardView } from "./SettingsPage";
import type { KeyStatus } from "./claudeKey";

const empty: AccountsView = { accounts: [], active: null, signingIn: null, inBrowser: false, attention: null, keyMode: false, upkeepLeftToClaude: true };
const sam = { id: "a1", email: "sam@example.com", organization: "Example Org", configDir: "C:\p\claude-accounts\a1", lastSignIn: 1 };
const kim = { id: "a2", email: "kim@example.com", organization: null, configDir: "C:\p\claude-accounts\a2", lastSignIn: 2 };
const html = (view: AccountsView) => renderToString(createElement(ClaudeAccountsView, { view, onAction: () => {} }));

test("with no accounts the section offers Add Account", () => {
  const h = html(empty);
  expect(h).toContain("Add Account");
  expect(h).toContain("No managed accounts");
});

test("a running sign-in asks to finish in the browser, with Cancel, and hides Add Account", () => {
  const h = html({ ...empty, signingIn: "x", inBrowser: true });
  expect(h).toContain("Finish signing in in the browser.");
  expect(h).toContain("Cancel");
  expect(h).not.toContain("Add Account");
});

test("rows show email and organisation; only the inactive one offers Make active", () => {
  const h = html({ ...empty, accounts: [sam, kim], active: "a1" });
  expect(h).toContain("sam@example.com");
  expect(h).toContain("Example Org");
  expect(h).toContain("No organisation");
  expect(h.match(/Make active/g)?.length).toBe(1);
  expect(h).toContain("Active");
});

test("with the 1-year key connected the section says the key wins for new panes", () => {
  expect(html({ ...empty, accounts: [sam], active: "a1", keyMode: true })).toContain("new Claude panes use the key");
  expect(html({ ...empty, accounts: [sam], active: "a1" })).not.toContain("new Claude panes use the key");
});

test("the Claude card offers the account route only while the key is not connected", () => {
  const off: KeyStatus = { connected: false, createdAt: null, expiresAt: null, daysLeft: null, renewDue: false, expired: false, settingUp: false, inBrowser: false, attention: null };
  const card = (s: KeyStatus) => renderToString(createElement(ClaudeCardView, { status: s, busy: false, onAction: () => {}, onUseAccount: () => {} }));
  expect(card(off)).toContain("Use my Claude account instead");
  expect(card({ ...off, connected: true, createdAt: 1, expiresAt: 2, daysLeft: 300 })).not.toContain("Use my Claude account instead");
});
