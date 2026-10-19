// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import ShareButton, { SHARE_X_LABEL } from "./ShareButton";

// Vite lists the files, so no Node types are needed: names from the lazy glob, text from the eager one.
const names = Object.keys(import.meta.glob("/src/{assets,usage}/**/*.*", { query: "?url", import: "default" }));
const texts = import.meta.glob("/src/{assets,usage}/**/*.{ts,tsx,css,svg}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

test("USAGE-020: the share-to-X button reads as the words Share on X and holds no picture", () => {
  const html = renderToStaticMarkup(createElement(ShareButton, { onShare: () => {} }));
  expect(html).toContain(`>${SHARE_X_LABEL}<`);
  expect(html).not.toMatch(/<svg|<img|<path|background-image|url\(/i);
  expect(html.match(/<button/g)).toHaveLength(1);
});

test("USAGE-020: a busy share button is disabled and still plain text", () => {
  const html = renderToStaticMarkup(createElement(ShareButton, { onShare: () => {}, busy: true }));
  expect(html).toContain("disabled");
  expect(html).not.toMatch(/<svg|<img/i);
});

test("USAGE-020: no X or Twitter logo file ships in the app's pictures or the usage code", () => {
  expect(names.length).toBeGreaterThan(10);
  const named = names.filter((f) => /(^|[/_.-])(x-?logo|twitter|x-?mark|x-?icon)([/_.-]|$)/i.test(f));
  expect(named).toEqual([]);
  // the usage and asset sources never inline the X glyph path or load it from a host
  for (const [f, text] of Object.entries(texts)) {
    if (f.endsWith("ShareButton.test.ts")) continue;
    expect(text, f).not.toMatch(/abs\.twimg|twimg\.com|M18\.901 1\.153h3\.68/);
  }
});
