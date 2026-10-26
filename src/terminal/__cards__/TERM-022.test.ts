// TERM-022 acceptance: the branch chip in the pane header. The git half (what the window receives for a branch, a
// detached HEAD and a plain folder) is src-tauri/tests/cards_03.rs term022_*; the shapes below are what it asserts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import TerminalPane from "../TerminalPane";
import { branchChip } from "../status";

const sha = "0123456789abcdef0123456789abcdef01234567";
const pane = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(TerminalPane as never, { agent: "claude", onClose: () => {}, ...props }));
// the file the pane header is drawn from (dynamic specifier: no node types in tsc)
const fsName = "node:fs";
const source: string = ((await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, e: string) => string }).readFileSync(new URL("../TerminalPane.tsx", import.meta.url), "utf8");

test("box 1: a pane in branch feature/x shows that branch; a folder outside git shows no chip", () => {
  expect(branchChip({ branch: "feature/x", head: sha })).toEqual({ text: "feature/x", tip: "feature/x" });
  expect(branchChip(null)).toBeNull(); // scm_head answers null for a folder outside git
  const inGit = pane({ cwd: "C:/work/app", branch: "feature/x" });
  expect(inGit).toContain('<span class="chip" title="feature/x">feature/x</span>');
  const plain = pane({ cwd: "C:/work/notes", branch: null });
  expect(plain).not.toContain('<span class="chip"');
});

test("box 2: the chip's hover (title) carries the whole branch name, and a detached checkout shows a short commit id", () => {
  const long = "feature/very-long-branch-name-that-the-chip-cannot-fit/with-more-segments";
  expect(branchChip({ branch: long, head: sha })).toEqual({ text: long, tip: long });
  expect(pane({ cwd: "C:/work/app", branch: long })).toContain(`<span class="chip" title="${long}">`);
  const detached = branchChip({ branch: null, head: sha });
  expect(detached?.text).toBe("0123456");
  expect(detached?.text.length).toBeLessThan(sha.length);
  expect(detached?.tip).toBe(`Detached at ${sha}`);
  // the header binds the chip's tip to its title (the window draws it from scm_head's answer once git replies)
  expect(source).toMatch(/<span className="chip" title=\{chip\.tip\}>\s*\{chip\.text\}/);
});
