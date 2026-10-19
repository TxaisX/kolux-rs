import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { AccountSwitcherView } from "./AccountSwitcher";
import { groupsOf } from "./accounts";

const claude = { accounts: [{ id: "c1", email: "work@example.com", organization: null, stale: false }], active: "c1", signingIn: null, keyMode: false, upkeepLeftToClaude: true };
const codex = { accounts: [{ id: "x1", email: "a@example.com", signInError: false }], active: null, signingIn: null, missing: [] };
const noop = () => {};
const view = (groups = groupsOf(claude, codex), open: { top: number; left: number } | null = null, error: string | null = null) => renderToString(createElement(AccountSwitcherView, { groups, open, error, onOpen: noop, onClose: noop, onPick: noop }));

test("T-548: the switcher draws nothing until a provider has a managed account", () => {
  expect(view([])).toBe("");
});

test("T-548: the top-bar pill names the account new Claude and Codex panes use, and the menu stays shut until clicked", () => {
  const html = view();
  expect(html).toContain("Claude work@example.com · Codex System default");
  expect(html).toContain('aria-haspopup="menu"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain('role="menu"');
});

test("T-548: the open menu lists System default and each account per provider as radio items, the active one checked", () => {
  const html = view(undefined, { top: 40, left: 10 });
  expect(html).toContain('aria-label="Claude accounts"');
  expect(html).toContain('aria-label="Codex accounts"');
  expect(html.match(/role="menuitemradio"/g)?.length).toBe(4);
  expect(html.match(/aria-checked="true"/g)?.length).toBe(2);
  expect(html).toContain("Panes already running keep their account.");
  expect(html).not.toContain("disabled");
});

test("T-548: while a sign-in runs the provider's rows are disabled and Settings is named; a failed switch shows its words", () => {
  const html = view(groupsOf({ ...claude, signingIn: "c9" }, null), { top: 0, left: 0 }, "That Claude account is no longer listed.");
  expect(html.match(/disabled/g)?.length).toBe(2);
  expect(html).toContain("A sign-in is running. Finish or cancel it in Settings first.");
  expect(html).toContain('role="alert"');
  expect(html).toContain("That Claude account is no longer listed.");
});

test("T-548: the 1-year key note shows under the Claude rows", () => {
  expect(view(groupsOf({ ...claude, keyMode: true }, null), { top: 0, left: 0 })).toContain("1-year key");
});
