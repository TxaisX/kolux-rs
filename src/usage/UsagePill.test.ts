import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { OPEN_SETTINGS } from "../settings/pages";
import UsagePill, { PILL_TITLE, UsagePillView } from "./UsagePill";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}) }));

afterEach(() => vi.unstubAllGlobals());

test("T-550: the usage pill is one button with the pill's look, named for where it goes", () => {
  const html = renderToString(createElement(UsagePillView, { hidden: false, onOpen: () => {} }, createElement("span", { className: "usage-part" }, "Claude 37% left")));
  expect(html.startsWith("<button")).toBe(true);
  expect(html).toContain('type="button"');
  expect(html).toContain('class="usage"');
  expect(html).toContain(`title="${PILL_TITLE.replace("&", "&amp;")}"`);
  expect(html).toContain("Accounts &amp; keys");
  expect(html).toContain("Claude 37% left");
  expect(html.match(/<button/g)?.length).toBe(1);
  expect(html).not.toContain("hidden");
});

test("T-550: with no figure to show the pill stays hidden", () => {
  expect(renderToString(createElement(UsagePillView, { hidden: true, onOpen: () => {} }))).toContain("hidden");
});

test("T-550: a click on the pill opens Settings at Accounts & keys, AI connections section", () => {
  const target = new EventTarget();
  vi.stubGlobal("window", target);
  const seen: unknown[] = [];
  target.addEventListener(OPEN_SETTINGS, (e) => seen.push((e as CustomEvent).detail));
  // FIX-2 (council P7): the click goes through the button the pill renders, not the handler alone
  type El = { type: unknown; props: { onClick?: () => void; onOpen?: () => void; [k: string]: unknown } };
  const pill = UsagePill({ hidden: false, claudeOn: true, codexOn: true }) as unknown as El;
  expect(pill.type).toBe(UsagePillView);
  const button = UsagePillView(pill.props as unknown as Parameters<typeof UsagePillView>[0]) as unknown as El;
  expect(button.type).toBe("button");
  button.props.onClick?.();
  expect(seen).toEqual([{ page: "accounts", section: "connections" }]);
});

// FIX-5 (council P2 P12): the hover title is not read out by every screen reader, so the same words are also the button's description.
test("FIX-5: the pill's words are also its description, not only a hover title", () => {
  const html = renderToString(createElement(UsagePillView, { hidden: false, onOpen: () => {} }));
  const id = html.match(/aria-describedby="([^"]+)"/)?.[1];
  expect(id).toBeTruthy();
  expect(html).toMatch(new RegExp(`<span id="${id}"[^>]*display:none[^>]*>Usage: open Settings › Accounts &amp; keys</span>`));
});
