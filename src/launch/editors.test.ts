// SESS-039: the "Open in" row wording.
import { expect, test } from "vitest";
import { openLabel, openTitle } from "./editors";

test("an editor row names the editor, and the tooltip names the folder, the program and a console for NeoVim", () => {
  const code = { id: "vscode", name: "VS Code", path: "C:\\tools\\code.cmd", console: false };
  const nvim = { id: "nvim", name: "NeoVim", path: "C:\\tools\\nvim.exe", console: true };
  expect(openLabel(code)).toBe("Open in VS Code");
  expect(openTitle(code, "C:\\work\\app")).toBe("Open C:\\work\\app in VS Code (C:\\tools\\code.cmd)");
  expect(openTitle(nvim, "C:\\work\\app")).toBe("Open C:\\work\\app in NeoVim in a console window (C:\\tools\\nvim.exe)");
});
