// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import ShareButton, { SHARE_X_LABEL } from "./ShareButton";

// Vite lists the files, so no Node types are needed: names from the lazy glob, text from the eager one.
// The whole of src, not just assets and usage: a logo in chrome/icons.tsx or a file in any folder counts (review 52195201 AFTER 3).
const names = Object.keys(import.meta.glob("/src/**/*.*", { query: "?url", import: "default" }));
const texts = import.meta.glob("/src/**/*.{ts,tsx,css,svg}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
/** An X or Twitter logo by file name, in either word order (x-logo, logo-x, x_mark, icon.x, twitter...). */
const X_NAME = /(^|[/_.-])(x[-_]?(logo|mark|icon|brand)|(logo|mark|icon|brand)[-_]?x|twitter|tweet)([/_.-]|$)/i;
/** The X glyph path start as the simple-icons set draws it and as X's own brand kit draws it, and the old image host. */
const X_GLYPH = /abs\.twimg|twimg\.com|M18\.901 1\.153h3\.68|M18\.244 2\.25h3\.308/;

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

test("USAGE-020: no X or Twitter logo file ships anywhere in src, whichever way the name is ordered", () => {
  expect(names.length).toBeGreaterThan(100);
  expect(names.filter((f) => X_NAME.test(f))).toEqual([]);
  // the name check itself catches both orders and leaves ordinary names alone
  for (const bad of ["/src/assets/x-logo.svg", "/src/assets/logo-x.svg", "/src/chrome/x_mark.png", "/src/usage/icon-x.svg", "/src/a/twitter.svg"]) expect(X_NAME.test(bad), bad).toBe(true);
  for (const ok of ["/src/chrome/index.ts", "/src/usage/Ring.tsx", "/src/terminal/max-width.ts", "/src/assets/vendors/openai-blossom-black.svg"]) expect(X_NAME.test(ok), ok).toBe(false);
});

test("USAGE-020: no source in src inlines the X glyph path or loads it from a host", () => {
  expect(Object.keys(texts).length).toBeGreaterThan(100);
  for (const [f, text] of Object.entries(texts)) {
    if (f.endsWith("ShareButton.test.ts")) continue;
    expect(text, f).not.toMatch(X_GLYPH);
  }
});
