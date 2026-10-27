// VIEW-026 class collision: the Board screen's grid is `.board`; the workspace board dialog must not share that class,
// or board.css (flex column) turns the screen's cards into 2x29 px slivers once it loads.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import WorkspaceBoard from "../WorkspaceBoard";

// Vitest returns "" for a .css import, so the stylesheets are read from disk (the project carries no Node types).
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const boardCss = nodeFs.readFileSync(new URL("../board.css", import.meta.url), "utf8");
const screenCss = nodeFs.readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

const selectors = (css: string) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?:^|})\s*([^{}]+)\{/g)].flatMap((m) => m[1].split(",").map((s) => s.trim()));

test("board.css has no rule on the bare .board class (it belongs to the Board screen in styles.css)", () => {
  const bare = selectors(boardCss).filter((s) => /^\.board(?![\w-])/.test(s));
  expect(bare).toEqual([]);
  expect(selectors(screenCss).some((s) => /^\.board(?![\w-])/.test(s))).toBe(true);
});

test("the workspace board dialog is ws-board, not board", () => {
  const html = renderToStaticMarkup(createElement(WorkspaceBoard, { onClose: () => {} }));
  const dialog = /<div[^>]*role="dialog"[^>]*>/.exec(html)?.[0] ?? "";
  const cls = /class="([^"]*)"/.exec(dialog)?.[1].split(/\s+/) ?? [];
  expect(cls).toContain("ws-board");
  expect(cls).not.toContain("board");
  expect(selectors(boardCss)).toContain(".ws-board");
});
