import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { CodexCardView, codexHeadline, codexTrouble, type CodexView } from "./CodexCard";

const off: CodexView = { accounts: [], active: null, systemDefault: "signed-out", signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null, drifted: [], missing: [] };
const kim = { id: "c1", email: "kim@example.com", home: "h1", lastSignIn: 1, signInError: false };
const html = (view: CodexView) => renderToString(createElement(CodexCardView, { view, onAction: () => {} }));

test("signed out, the card offers Connect and Sign in with a code", () => {
  const h = html(off);
  expect(h).toContain("Connect with your ChatGPT plan");
  expect(h).toContain("Connect");
  expect(h).toContain("Sign in with a code");
  expect(h).toContain("Not connected");
});

test("the device view waits until it has both the link and the code", () => {
  const waiting = { ...off, signingIn: "device" as const, deviceLink: "https://auth.example.com/device" };
  expect(html(waiting)).not.toContain("auth.example.com");
  expect(codexHeadline(waiting)).toMatch(/Asking/);
  const both = { ...waiting, deviceCode: "ABCD-12345" };
  const h = html(both);
  expect(h).toContain("ABCD-12345");
  expect(h).toContain("https://auth.example.com/device");
  expect(h).toContain("Cancel");
  expect(h).not.toContain("Sign in with a code");
});

test("Codex's own login is reported truthfully when Kolux has no account", () => {
  expect(codexHeadline({ ...off, systemDefault: "chatgpt" })).toContain("a ChatGPT sign-in");
  expect(codexHeadline({ ...off, systemDefault: "custom-provider" })).toContain("an API key with a custom provider");
  expect(codexHeadline({ ...off, systemDefault: "api-key" })).toContain("an API key");
});

test("a connected account shows its email, and Connect becomes Add account", () => {
  const h = html({ ...off, accounts: [kim], active: "c1" });
  expect(h).toContain("Connected · kim@example.com");
  expect(h).toContain("Add account");
  expect(h).toContain("Active");
});

test("an account with a sign-in error or a changed settings file is marked and offers Sign in again (SET-030)", () => {
  const view = { ...off, accounts: [kim, { ...kim, id: "c2", email: "lee@example.com" }], active: "c1", drifted: ["c2"] };
  expect(codexTrouble(view, kim)).toBeNull();
  expect(codexTrouble(view, view.accounts[1])).toBe("Settings changed");
  expect(codexTrouble({ ...view, drifted: [] }, { ...kim, signInError: true })).toBe("Needs re-auth");
  const out = html(view);
  expect(out).toContain("Settings changed");
  expect(out).toContain("Sign in again puts Kolux");
  expect(html({ ...view, drifted: [] })).not.toContain("Sign in again");
});

const asking = (view: CodexView, confirming: string | null) => renderToString(createElement(CodexCardView, { view, confirming, onAction: () => {} }));
const sys = (v: CodexView) => renderToString(createElement(CodexCardView, { view: v, onAction: () => {} }));

test("ACCT-020: the System default row says how Codex's own login is signed in", () => {
  expect(sys({ ...off, systemDefault: "chatgpt" })).toContain("Signed in with ChatGPT");
  expect(sys({ ...off, systemDefault: "api-key" })).toContain("Running on an API key");
  expect(sys({ ...off, systemDefault: "custom-provider" })).toContain("API key with a custom provider");
  expect(sys({ ...off, systemDefault: "custom-provider" })).not.toContain("Signed in with ChatGPT");
  expect(sys(off)).toContain("Signed out");
});

test("ACCT-019: the System default row is first and Active with no managed account chosen", () => {
  const h = sys({ ...off, accounts: [kim], systemDefault: "chatgpt" });
  expect(h.indexOf("System default")).toBeLessThan(h.indexOf("kim@example.com"));
  expect(h.match(/>Active</g)?.length).toBe(1);
});

test("ACCT-019: rows warn needs sign-in when the file is missing, needs re-auth on a sign-in error, and offer Remove", () => {
  const lee = { ...kim, id: "c2", email: "lee@example.com", signInError: true };
  const view = { ...off, accounts: [kim, lee], active: "c1", missing: ["c1"] };
  expect(codexTrouble(view, kim)).toBe("Needs sign-in");
  expect(codexTrouble(view, lee)).toBe("Needs re-auth");
  const h = sys(view);
  expect(h.match(/>Remove</g)?.length).toBe(2);
  expect(h).toContain("Last signed in");
});

test("ACCT-019: Remove asks first; removing the active one hands back to the system default", () => {
  const view = { ...off, accounts: [kim], active: "c1" };
  const h = asking(view, "c1");
  expect(h).toContain("Remove kim@example.com?");
  expect(h).toContain("takes over");
  expect(h).toContain("Keep");
});
