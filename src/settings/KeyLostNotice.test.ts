// ACCT-010: the note for a key this computer could no longer open says which and where to reconnect.
import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { KeyLostView, lostText } from "./KeyLostNotice";

test("the note names each cleared key and says where to reconnect it", () => {
  expect(lostText(["claudeOauthToken"])).toBe("Your Claude 1-year key could not be opened on this computer, so it was cleared. Reconnect it in Settings › Accounts & keys.");
  expect(lostText(["claudeOauthToken", "xaiApiKey"])).toBe("Your Claude 1-year key and xAI key could not be opened on this computer, so they were cleared. Reconnect them in Settings › Accounts & keys.");
  expect(lostText(["somethingNew"])).toContain("A stored key could not be opened");
  expect(lostText([])).toBeNull();
});

test("nothing shows when no key was cleared", () => {
  const noop = () => {};
  expect(renderToString(createElement(KeyLostView, { names: [], onOpen: noop, onDismiss: noop }))).toBe("");
  const html = renderToString(createElement(KeyLostView, { names: ["claudeOauthToken"], onOpen: noop, onDismiss: noop }));
  expect(html).toContain('role="status"');
  expect(html).toContain("Open Accounts &amp; keys");
  expect(html).toContain("Dismiss");
});
