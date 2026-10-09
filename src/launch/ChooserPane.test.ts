// The chooser rendered to HTML with no browser: Start follows the seats' readiness, the close
// button follows `closable`, the model row appears once an AI is picked.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import ChooserPane from "./ChooserPane";
import type { AgentInfo } from "./PlusMenu";
import { defaultCopies, TERMINAL, type Copies, type Seat } from "./seats";

const claude: AgentInfo = { id: "claude", name: "Claude Code", program: "claude", args: [], installed: true, path: "C:\\bin\\claude.exe" };
const render = (seats: Seat[], closable = true, inGit = true, copies: Copies = defaultCopies(seats.length, inGit)) =>
  renderToString(createElement(ChooserPane, { number: 2, agents: [claude], seats, onSeats: () => {}, onStart: () => {}, copies, inGit, onCopies: () => {}, closable, onClose: () => {} }));
const radio = (html: string, label: string) => html.split("<label").find((l) => l.includes(label))!;
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

test("SESS-051: an AI seat offers an opening prompt field; a Terminal seat has none", () => {
  const ai = render([{ agent: "claude", model: "opus", prompt: "Fix it" }]);
  expect(ai).toContain("Opening prompt (optional)");
  expect(ai).toContain("Fix it");
  expect(render([{ agent: TERMINAL, model: null }])).not.toContain("Opening prompt");
  expect(render([{ agent: null, model: null }])).not.toContain("Opening prompt");
});

test("SESS-015: three blank seats keep Start disabled and show the no-guessing caption; Same for all waits for a finished seat", () => {
  const blank = render([{ agent: null, model: null }, { agent: null, model: null }, { agent: null, model: null }]);
  expect(startButton(blank)).toContain("disabled");
  expect(blank).toContain("Kolux never picks an AI or a model for you");
  expect(blank.split("<button").find((b) => b.includes("Same for all"))).toContain("disabled");
  const one = render([{ agent: "claude", model: "opus" }, { agent: null, model: null }, { agent: null, model: null }]);
  expect(one.split("<button").find((b) => b.includes("Same for all"))).not.toContain("disabled");
  expect(render([{ agent: "claude", model: "opus" }]).split("<button").find((b) => b.includes("Same for all"))).toContain("disabled");
  expect(render([{ agent: null, model: null, title: "Review" }])).toContain('value="Review"');
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

test("SESS-014: three seats in Git pick separate copies; sharing them warns with a fix; outside Git separate is disabled and explained", () => {
  const three: Seat[] = [{ agent: "claude", model: "opus" }, { agent: "claude", model: "opus" }, { agent: "claude", model: "opus" }];
  const separate = render(three);
  expect(radio(separate, "Separate copy for each AI")).toContain("checked");
  expect(separate).not.toContain("Give each its own copy");
  const shared = render(three, true, true, "shared");
  expect(radio(shared, "Same folder for all")).toContain("checked");
  expect(shared).toContain("Several AIs would be editing the same files at once");
  expect(shared).toContain("Give each its own copy");
  const one = render([three[0]]);
  expect(radio(one, "Same folder for all")).toContain("checked");
  expect(one).not.toContain("Give each its own copy");
  const outside = render(three, true, false);
  expect(radio(outside, "Separate copy for each AI")).toContain("disabled");
  expect(radio(outside, "Same folder for all")).toContain("checked");
  expect(outside).toContain("Not a Git project: there is nothing to copy");
  expect(outside).not.toContain("Give each its own copy");
});
