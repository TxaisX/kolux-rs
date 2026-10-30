// STAT-052 acceptance: one agent taken through working, waiting and done changes its glyph and its
// hover text each time (header and glyph markup both read the one vocabulary); under reduced motion the
// stylesheet stops every spinner while the working glyph and words are unchanged.
import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusGlyph } from "../icons";
import { VOCAB, headerOf } from "../../terminal/status";

const now = 1_000_000;
const header = (hook?: "working" | "waiting" | "done") => headerOf("claude", "running", null, false, hook === "done" ? now - 1000 : null, now, hook);
const glyphHtml = (g: Parameters<typeof StatusGlyph>[0]["glyph"]) => renderToStaticMarkup(createElement(StatusGlyph, { glyph: g, size: 12 }));

test("box 1: working, then waiting, then done each give a different glyph and different hover text", () => {
  const steps = [header(), header("waiting"), header("done")];
  expect(steps.map((h) => h.state)).toEqual(["working", "waiting", "done"]);
  expect(new Set(steps.map((h) => h.glyph)).size).toBe(3);
  expect(new Set(steps.map((h) => h.explain)).size).toBe(3);
  expect(new Set(steps.map((h) => glyphHtml(h.glyph))).size).toBe(3); // the drawn glyph differs too
  // The hover text of every surface is the vocabulary's explain text (data-tip), not a per-surface string.
  expect(steps.map((h) => h.explain)).toEqual([VOCAB.working.explain, VOCAB.waiting.explain, VOCAB.done.explain]);
  expect(steps[0].glyph).toBe("spinner");
  expect(steps[2].glyph).toBe("check");
});

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const rawCss = nodeFs.readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
// Line ends are normalised so the result is the same on a CRLF (Windows) and an LF (CI) checkout.
const css = rawCss.replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map((m) => m[1]).join("\n");

test("box 2: under reduced motion every .spin rule has its animation switched off; the working glyph and words are untouched", () => {
  // Every rule that gives a spinner an animation, and the rules the reduce block turns off. Each selector
  // must start its rule there, so `.statusbar .skill-item .spin { animation: none }` does not count for `.spin`.
  const animated = [...css.matchAll(/(?:^|\n)([^{}\n@]*\.spin[^{}]*)\{[^{}]*animation:(?!\s*none)[^;}]+/g)].map((m) => m[1].trim());
  expect(animated).toEqual([".spin", ".statusbar .skill-item .spin"]);
  for (const sel of animated) expect(reduced).toMatch(new RegExp(`(?:^|[{};\\n])\\s*${sel.replace(/[.]/g, "\\.")}\\s*\\{\\s*animation:\\s*none`));
  // 12 frames a second: one turn per second in 12 steps.
  expect(css).toMatch(/\.spin\s*\{\s*animation:\s*spin 1s steps\(12\) infinite/);
  // The spinner still draws (only the animation stops) and the state still reads as working.
  expect(glyphHtml("spinner")).toContain('class="spin"');
  expect(header().word).toBe("Working");
});
