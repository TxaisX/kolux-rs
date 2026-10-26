// STAT-046 acceptance: the expired sign-in notice in the main window. Runs the real SignInNotice
// component body (its effects, its reads of claude_accounts, its re-read on the claude-accounts event)
// with a stand-in for React's hooks and a fake account list; no sign-in file or real account is read.
// The Rust half (a status that is not signed in marks the account stale; a new sign-in clears it) is
// claude_accounts::tests::{identity_needs_a_signed_in_status, a_stale_account_is_marked_once_and_a_new_sign_in_clears_it}.
import { beforeEach, expect, test, vi } from "vitest";

const slots: unknown[] = [];
const ran = new Set<number>();
let si = 0;
const pending: (() => void)[] = [];
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useState: (init: unknown) => {
    const i = si++;
    if (!(i in slots)) slots[i] = typeof init === "function" ? (init as () => unknown)() : init;
    return [slots[i], (v: unknown) => (slots[i] = typeof v === "function" ? (v as (o: unknown) => unknown)(slots[i]) : v)];
  },
  useEffect: (f: () => void) => {
    const i = si++;
    if (ran.has(i)) return;
    ran.add(i);
    pending.push(f);
  },
}));
const listeners: Record<string, () => void> = {};
const sent: { cmd: string; args?: Record<string, unknown> }[] = [];
let claudeView: unknown;
let codexView: unknown;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => {
    sent.push({ cmd, args });
    return Promise.resolve(cmd === "claude_accounts" ? claudeView : cmd === "codex_accounts" ? codexView : null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: (name: string, f: () => void) => ((listeners[name] = f), Promise.resolve(() => {})) }));
vi.mock("../codexSignInScan", () => ({ startCodexSignInScan: () => () => {} }));
const { default: SignInNotice, SignInNoticeView } = await import("../SignInNotice");
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");

type El = { props: { lapsed: { agent: string; id: string; label: string; busy: boolean } | null; onSignIn: (l: never) => void } };
const account = (id: string, email: string, stale: boolean) => ({ id, email, organization: null, configDir: `G:/Temp/cards-v3/${id}`, lastSignIn: 1, stale });
const claudeOf = (accounts: ReturnType<typeof account>[], active: string | null) => ({ accounts, active, signingIn: null, inBrowser: false, attention: null, keyMode: false, upkeepLeftToClaude: false });
const codexEmpty = { accounts: [], active: null, systemDefault: "chatgpt", signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null, drifted: [], missing: [], settingsWarning: null };
const tick = () => new Promise((r) => setTimeout(r, 10));
const draw = async (): Promise<El> => {
  si = 0;
  SignInNotice();
  pending.splice(0).forEach((f) => f());
  await tick();
  si = 0;
  return SignInNotice() as unknown as El;
};
const words = (el: El) => renderToStaticMarkup(createElement(SignInNoticeView, el.props as never));

beforeEach(() => {
  slots.length = 0;
  ran.clear();
  sent.length = 0;
  codexView = codexEmpty;
});

test("box 1: an account whose sign-in lapsed brings the notice; signing in again makes it go away", async () => {
  claudeView = claudeOf([account("a1", "sam@example.com", true)], "a1");
  const first = await draw();
  let el = first;
  expect(el.props.lapsed).toEqual({ agent: "claude", id: "a1", label: "Claude account sam@example.com", busy: false });
  expect(words(el)).toContain("Claude account sam@example.com is no longer signed in.");
  expect(words(el)).toContain("Sign in again");
  // The button starts the sign-in flow for that account.
  el.props.onSignIn(el.props.lapsed as never);
  expect(sent.filter((s) => s.cmd === "claude_account_sign_in")).toEqual([{ cmd: "claude_account_sign_in", args: { id: "a1" } }]);
  // The sign-in finishes: the account is fresh and the backend says so with its claude-accounts event.
  claudeView = claudeOf([account("a1", "sam@example.com", false)], "a1");
  listeners["claude-accounts"]();
  await tick();
  si = 0;
  el = SignInNotice() as unknown as El;
  expect(el.props.lapsed).toBeNull();
  expect(words(el)).toBe("");
});

test("box 2: two saved accounts, one expired: only the expired one is named", async () => {
  claudeView = claudeOf([account("a1", "sam@example.com", false), account("a2", "kim@example.com", true)], "a2");
  const el = await draw();
  expect(el.props.lapsed).toMatchObject({ agent: "claude", id: "a2", label: "Claude account kim@example.com" });
  const html = words(el);
  expect(html).toContain("kim@example.com");
  expect(html).not.toContain("sam@example.com");
});

test("note (ACCT-012 rule, which STAT-046 box 2 leaves open): an expired account that is not the active one raises no notice", async () => {
  claudeView = claudeOf([account("a1", "sam@example.com", false), account("a2", "kim@example.com", true)], "a1");
  const el = await draw();
  expect(el.props.lapsed).toBeNull();
});
