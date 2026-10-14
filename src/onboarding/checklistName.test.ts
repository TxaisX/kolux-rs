import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ItemName } from "./Checklist";

test("ONB-013 (FIX-1): a ticked checklist item tells screen readers it is done; an open one does not", () => {
  const done = renderToStaticMarkup(createElement(ItemName, { label: "Connect an AI", ticked: true }));
  const open = renderToStaticMarkup(createElement(ItemName, { label: "Run a kit", ticked: false }));
  expect(done).toBe('<span class="name">Connect an AI<span class="onb-sr"> (done)</span></span>');
  expect(open).toBe('<span class="name">Run a kit</span>');
});
