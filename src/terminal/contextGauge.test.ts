import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextGauge } from "./TerminalPane";

const gauge = (context: number | null | undefined, agent = "claude") => renderToStaticMarkup(createElement(ContextGauge, { context, agent }));

test("an agent pane with no reading yet shows a greyed 0% that says nothing has come in (USAGE-001)", () => {
  for (const none of [null, undefined]) {
    const html = gauge(none);
    expect(html).toContain('class="gauge none"');
    expect(html).toContain(">0%<");
    expect(html).toContain("nothing received yet");
  }
});

test("a real 0% reading is a reading, not the greyed placeholder (USAGE-001)", () => {
  const html = gauge(0);
  expect(html).toContain('class="gauge"');
  expect(html).not.toContain("nothing received yet");
  expect(html).toContain("Context used: 0%");
});

test("the gauge tints yellow from 70% and red beyond 90% (USAGE-001)", () => {
  expect(gauge(69)).toContain('class="gauge"');
  expect(gauge(70)).toContain('class="gauge warn"');
  expect(gauge(90)).toContain('class="gauge warn"');
  expect(gauge(91)).toContain('class="gauge danger"');
  expect(gauge(91)).toContain(">91%<");
});

test("a shell pane's gauge says it is for agents only (USAGE-001)", () => {
  const html = gauge(undefined, "shell");
  expect(html).toContain('class="gauge none"');
  expect(html).toContain("agents only");
});
