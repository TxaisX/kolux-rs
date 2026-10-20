// SET-022 / SET-025 / SET-026 (T-247-d): the Terminal page's drawing and input controls.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { InputCard, PowerShellCard } from "./InputCards";
import { searchSettings } from "./search";

const html = (c: typeof InputCard | typeof PowerShellCard, settings: Record<string, unknown>, platform: "win32" | "linux" | "darwin") => renderToString(createElement(c as never, { settings, platform, onSave: () => {} }));

test("SET-025: the input card shows every switch with the saved value; the Option key row is macOS only", () => {
  const h = html(InputCard, { terminalHidePointer: true, terminalFullScreenScroll: 8 }, "linux");
  for (const t of ["Font ligatures", "GPU drawing", "Middle-click pastes", "OSC 52", "Hide the pointer while typing", "Focus follows the mouse", "Full-screen scroll speed", "Yen key types a backslash"]) expect(h).toContain(t);
  expect(h).not.toContain("Option key acts as Alt");
  expect(h).toContain('value="8"');
  expect(html(InputCard, {}, "darwin")).toContain("Option key acts as Alt");
});

test("SET-025: middle-click starts on for Linux and off for Windows, OSC 52 starts on", () => {
  const checked = (h: string, label: string) => new RegExp(`role="switch"(?:[^>]*checked)[^>]*/>${label}`).test(h) || new RegExp(`checked=""[^>]*role="switch"[^>]*/>${label}`).test(h);
  expect(checked(html(InputCard, {}, "linux"), "Middle-click")).toBe(true);
  expect(checked(html(InputCard, {}, "win32"), "Middle-click")).toBe(false);
  expect(checked(html(InputCard, {}, "win32"), "Programs may copy")).toBe(true);
});

test("SET-026: the PowerShell version card exists on Windows only", () => {
  expect(html(PowerShellCard, { powershellVersion: "5" }, "win32")).toContain("Windows PowerShell 5");
  expect(html(PowerShellCard, {}, "linux")).toBe("");
  expect(html(PowerShellCard, {}, "darwin")).toBe("");
});

const found = (q: string, section: string) => searchSettings(q)?.pages.some((h) => h.page === "terminal" && (h.sections === "all" || h.sections.includes(section)));

test("SET-022: a search for the new controls finds the Terminal page's input card", () => {
  for (const q of ["ligatures", "gpu", "middle click", "osc 52", "hide pointer", "focus follows", "yen", "option alt"]) {
    expect(found(q, "input"), q).toBe(true);
  }
  expect(found("powershell 7", "powershell")).toBe(true);
});
