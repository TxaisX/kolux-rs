import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { CodexCardView, codexHeadline, codexTrouble, type CodexView } from "./CodexCard";

const off: CodexView = { accounts: [], active: null, systemDefault: "signed-out", signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null, drifted: [] };
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
  expect(codexTrouble({ ...view, drifted: [] }, { ...kim, signInError: true })).toBe("Needs sign-in");
  const out = html(view);
  expect(out).toContain("Settings changed");
  expect(out).toContain("Sign in again puts Kolux");
  expect(html({ ...view, drifted: [] })).not.toContain("Sign in again");
});
