// The chooser rendered to HTML with no browser: Start follows the seats' readiness, the close
// button follows `closable`, the model row appears once an AI is picked.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import ChooserPane from "./ChooserPane";
import type { AgentInfo } from "./PlusMenu";
import { TERMINAL, type Seat } from "./seats";

const claude: AgentInfo = { id: "claude", name: "Claude Code", program: "claude", args: [], installed: true, path: "C:\\bin\\claude.exe" };
const render = (seats: Seat[], closable = true) =>
  renderToString(createElement(ChooserPane, { number: 2, agents: [claude], seats, onSeats: () => {}, onStart: () => {}, closable, onClose: () => {} }));
const startButton = (html: string) => html.split("<button").find((b) => b.includes("Start"))!;

test("SESS-007: Claude without a model keeps Start disabled, a model enables it, Terminal is enabled at once", () => {
  const noModel = render([{ agent: "claude", model: null }]);
  expect(startButton(noModel)).toContain("disabled");
  expect(noModel).toContain("Pick a model");
  expect(noModel).toContain("Claude Opus");
  const withModel = render([{ agent: "claude", model: "opus" }]);
  expect(startButton(withModel)).not.toContain("disabled");
  const term = render([{ agent: TERMINAL, model: null }]);
  expect(startButton(term)).not.toContain("disabled");
  expect(term).not.toContain("Pick a model");
  expect(render([{ agent: null, model: null }])).toContain("Session 2");
});

test("the grid's only pane has no close button; otherwise it does", () => {
  expect(render([{ agent: null, model: null }], false)).not.toContain("Close this chooser");
  expect(render([{ agent: null, model: null }], true)).toContain("Close this chooser");
});

test("SESS-013: the count row shows the quick picks and one seat block per seat", () => {
  const html = render([{ agent: null, model: null }, { agent: null, model: null }, { agent: null, model: null }]);
  for (const n of [1, 2, 3, 4, 6, 8]) expect(html).toContain(`>${n}</button>`);
  expect(html).toContain("Seat 3");
  expect(html).not.toContain("Seat 4");
  expect(html).toContain('value="3"');
  expect(html).toContain("Start 3");
});
