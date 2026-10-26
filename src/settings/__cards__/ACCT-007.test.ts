// ACCT-007 acceptance, the card half: the device-code view and the connected card. The code text below
// is the one the stand-in Codex prints in src-tauri/tests/cards_07.rs acct007_box1 (WXYZ-6789).
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { CodexCardView, codexState, type CodexView } from "../CodexCard";

const off: CodexView = { accounts: [], active: null, systemDefault: "signed-out", signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null, drifted: [], missing: [], settingsWarning: null };
const html = (view: CodexView) => renderToString(createElement(CodexCardView, { view, onAction: () => {} }));

test("box 1: Sign in with a code shows the code, and once the other device signs in the card reads connected", () => {
  const waiting = { ...off, signingIn: "device" as const, deviceLink: "https://auth.example.com/codex/device", deviceCode: "WXYZ-6789" };
  expect(codexState(waiting)).toBe("connecting");
  const h = html(waiting);
  expect(h).toContain("WXYZ-6789");
  expect(h).toContain("https://auth.example.com/codex/device");
  expect(h).toContain("Enter the code on any device");
  const kim = { id: "c1", email: "kim@example.com", home: "h1", lastSignIn: 1, signInError: false };
  const done = { ...off, accounts: [kim], active: "c1" };
  expect(codexState(done)).toBe("connected");
  const d = html(done);
  expect(d).toContain("Connected · kim@example.com");
  expect(d).not.toContain("WXYZ-6789");
});
