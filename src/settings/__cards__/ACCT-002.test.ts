// ACCT-002 acceptance, the window half. The real CodexCard (default export) is called with its
// state kept by shallow-react.ts and the backend replaced by a recorder; the process half (browser step,
// Cancel ends the login, no partial account) is src-tauri/tests/cards_07.rs acct002_box1/box2.
// MIRROR CodexCard.tsx act() (Connect/Cancel -> codex_account_sign_in / codex_account_cancel, then read).
import { expect, test, vi } from "vitest";
import CodexCard, { CodexCardView, codexState, type CodexView } from "../CodexCard";
import { everyString, find, findAll, mount, textOf, type El } from "./shallow-react";

vi.mock("react", async (orig) => (await import("./shallow-react")).patchReact(await orig<object>()));
const h = vi.hoisted(() => ({ calls: [] as [string, unknown][], backend: null as unknown, open: [] as (() => void)[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => {
    h.calls.push([cmd, args]);
    return cmd === "codex_accounts" ? Promise.resolve(h.backend) : new Promise<void>((done) => h.open.push(done));
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));

const none: CodexView = { accounts: [], active: null, systemDefault: "signed-out", signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null, drifted: [], missing: [], settingsWarning: null };
const connecting: CodexView = { ...none, signingIn: "browser", inBrowser: true };
const kim: CodexView = { ...none, accounts: [{ id: "c1", email: "kim@example.com", home: "<codex-home>", lastSignIn: 1, signInError: false }], active: "c1" };
const settle = () => new Promise((r) => setTimeout(r, 5));
const card = (tree: El) => CodexCardView(find(tree, (e) => e.type === CodexCardView).props as never) as unknown as El;
const button = (tree: El, label: string) => findAll(card(tree), (e) => e.type === "button" && textOf(e) === label)[0];
const sectionOf = (tree: El) => card(tree).props["data-state"];

test("box 1: Connect starts the ChatGPT browser sign-in; the card shows connecting with Cancel; done, it is connected with the account label", async () => {
  h.calls.length = h.open.length = 0;
  const page = mount(CodexCard, {}, { 0: none });
  let tree = page.render();
  expect(sectionOf(tree)).toBe("disconnected");
  expect(button(tree, "Connect").props.disabled).toBe(false);
  button(tree, "Connect").props.onClick();
  expect(h.calls).toEqual([["codex_account_sign_in", { device: false, again: null }]]);
  tree = page.render();
  expect(button(tree, "Connect").props.disabled).toBe(true);
  // What the backend reports while the login runs: the card says connecting and offers Cancel only.
  const mid = mount(CodexCard, {}, { 0: connecting }).render();
  expect(codexState(connecting)).toBe("connecting");
  expect(sectionOf(mid)).toBe("connecting");
  expect(textOf(card(mid))).toContain("Finish signing in in the browser");
  expect(textOf(card(mid))).toContain("Connecting");
  expect(button(mid, "Cancel")).toBeDefined();
  expect(button(mid, "Connect")).toBeUndefined();
  // The login ends with an account: the card reads it back and shows the label, with no restart.
  const page2 = mount(CodexCard, {}, { 0: none });
  page2.render();
  button(page2.render(), "Connect").props.onClick();
  h.backend = kim;
  h.open.forEach((done) => done());
  await settle();
  tree = page2.render();
  expect(h.calls[h.calls.length - 1]).toEqual(["codex_accounts", undefined]);
  expect(sectionOf(tree)).toBe("connected");
  expect(textOf(card(tree))).toContain("Connected · kim@example.com");
  expect(button(tree, "Cancel")).toBeUndefined();
  expect(button(tree, "Disconnect")).toBeDefined();
});

test("box 2: Cancel while connecting stops the sign-in and the card returns to not connected with no account", async () => {
  h.calls.length = h.open.length = 0;
  const page = mount(CodexCard, {}, { 0: connecting });
  let tree = page.render();
  expect(sectionOf(tree)).toBe("connecting");
  button(tree, "Cancel").props.onClick();
  expect(h.calls).toEqual([["codex_account_cancel", undefined]]);
  h.backend = none;
  h.open.forEach((done) => done());
  await settle();
  tree = page.render();
  expect(sectionOf(tree)).toBe("disconnected");
  expect(textOf(card(tree))).toContain("Not connected");
  expect(textOf(card(tree))).toContain("Connect with your ChatGPT plan");
  expect(button(tree, "Connect")).toBeDefined();
  expect(button(tree, "Cancel")).toBeUndefined();
  expect(everyString(card(tree)).some((s) => s.includes("@"))).toBe(false);
});
