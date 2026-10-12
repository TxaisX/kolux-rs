// The chooser rendered to HTML with no browser: Start follows the seats' readiness, the close
// button follows `closable`, the model row appears once an AI is picked.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import ChooserPane from "./ChooserPane";
import type { AgentInfo } from "./PlusMenu";
import { defaultCopies, pickShape, TERMINAL, type Copies, type SavedShape, type Seat, type Shape } from "./seats";

const claude: AgentInfo = { id: "claude", name: "Claude Code", program: "claude", args: [], installed: true, path: "C:\\bin\\claude.exe" };
const render = (seats: Seat[], closable = true, inGit = true, copies: Copies = defaultCopies(seats.length, inGit), shape: Shape = "custom", task = "", saved: SavedShape[] = []) =>
  renderToString(createElement(ChooserPane, { number: 2, agents: [claude], seats, onSeats: () => {}, onLineup: () => {}, shape, task, onTask: () => {}, onStart: () => {}, copies, inGit, onCopies: () => {}, closable, onClose: () => {}, saved, onSaved: () => {}, onPickSaved: () => {} }));
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

test("SESS-012: the lineup shows the shape row, a task for every seat, and each seat with its role before anything starts", () => {
  const swarm = pickShape("swarm", [{ agent: "claude", model: "opus" }]);
  const html = render(swarm, true, true, "separate", "swarm", "Fix the login page");
  for (const s of ["Solo", "Pair", "Workbench", "Swarm", "Custom"]) expect(html).toContain(`>${s}</button>`);
  expect(html.split("<button").find((b) => b.includes(">Swarm<"))).toContain('aria-pressed="true"');
  expect(html).toContain("Task for every seat");
  expect(html).toContain("Fix the login page");
  const roles = [...html.matchAll(/class="chip seat-role"[^>]*>([a-z]+)</g)].map((m) => m[1]);
  expect(roles).toEqual(["scout", "builder", "builder", "tester", "reviewer"]);
  const custom = render(swarm.slice(0, 2).map((s) => ({ ...s, role: undefined })));
  expect(custom.split("<button").find((b) => b.includes(">Custom<"))).toContain('aria-pressed="true"');
  expect(custom).not.toContain("seat-role");
});

// In a small pane (the 4- and 6-pane grids) the choices scroll; Start must sit below them, not
// at their end, or picking Terminal is followed by a Start the user cannot see.
test("SESS-007: Start sits in a footer after the scrolling choices", () => {
  const html = render([{ agent: TERMINAL, model: null }]);
  const body = html.indexOf('class="chooser-body"');
  const foot = html.indexOf('class="chooser-foot');
  expect(body).toBeGreaterThan(-1);
  expect(foot).toBeGreaterThan(body);
  expect(html.indexOf(">Start<", foot)).toBeGreaterThan(foot);
});

test("SESS-022: no usage figures, no warning line above Start", () => {
  expect(render([{ agent: "claude", model: "opus" }])).not.toContain("note warn");
});

test("SESS-020: Save as team waits until every seat is picked; saved shapes sit after the built-in ones", () => {
  const save = (html: string) => html.split("<button").find((b) => b.includes("Save as team"))!;
  expect(save(render([{ agent: "claude", model: null }]))).toContain("disabled");
  expect(save(render([{ agent: "claude", model: "opus" }]))).not.toContain("disabled");
  const html = render([{ agent: "claude", model: "opus" }], true, true, "shared", "custom", "", [{ name: "Review crew", seats: [{ agent: "claude", model: "opus", role: "builder" }], copies: "shared" }]);
  expect(html.indexOf("Review crew")).toBeGreaterThan(html.indexOf("Custom"));
  expect(html).toContain("Rename or delete Review crew");
});

test("SESS-002: Start waits for a search that succeeded, and an errored one says so", () => {
  const seats: Seat[] = [{ agent: TERMINAL, model: null }];
  const view = (pass: { looking: boolean; done: boolean; error: string | null }) =>
    renderToString(createElement(ChooserPane, { saved: [], onSaved: () => {}, onPickSaved: () => {}, number: 2, agents: [claude], seats, onSeats: () => {}, onLineup: () => {}, shape: "custom", task: "", onTask: () => {}, onStart: () => {}, copies: "shared", inGit: false, onCopies: () => {}, closable: true, onClose: () => {}, pass, onRefresh: () => {} }));
  const start = (html: string) => html.split("</button>").find((b) => b.includes("Start"))!;
  expect(start(view({ looking: false, done: true, error: null }))).not.toContain("disabled");
  const failed = view({ looking: false, done: true, error: "IPC down" });
  expect(failed.replace(/<!-- -->/g, "")).toContain("could not look for agents (IPC down)");
  expect(start(failed)).toContain("disabled");
  const first = view({ looking: true, done: false, error: null });
  expect(first).toContain("Looking for agents");
  expect(start(first)).toContain("disabled");
  expect(view({ looking: false, done: true, error: null })).toContain("Refresh agents");
});

test("SESS-016: the effort picker and fast mode show on the seat whose model has them, and no other", () => {
  const html = render([{ agent: "claude", model: "opus" }, { agent: "claude", model: "haiku" }]);
  expect(html).toContain("Seat 1: effort");
  expect(html).toContain("Seat 1: fast mode");
  expect(html).not.toContain("Seat 2: effort");
  expect(html).not.toContain("Seat 2: fast mode");
  expect(render([{ agent: "claude", model: "sonnet" }])).not.toContain("fast mode");
});

test("SESS-021: Use last lineup shows only when offered, naming the remembered agents", () => {
  const props = { saved: [], onSaved: () => {}, onPickSaved: () => {}, number: 2, agents: [claude], seats: [{ agent: null, model: null }], onSeats: () => {}, onLineup: () => {}, shape: "custom" as Shape, task: "", onTask: () => {}, onStart: () => {}, copies: "shared" as Copies, inGit: true, onCopies: () => {}, closable: true, onClose: () => {}, onUseLineup: () => {} };
  const lineup = { shape: "pair" as Shape, copies: "separate" as Copies, seats: [{ agent: "codex", model: "gpt-5" }, { agent: "claude", model: "opus" }] };
  expect(renderToString(createElement(ChooserPane, { ...props, lastLineup: lineup }))).toContain("Use last lineup: codex, Claude Code");
  expect(renderToString(createElement(ChooserPane, { ...props, lastLineup: null }))).not.toContain("Use last lineup");
});
