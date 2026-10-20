// SET-007 (T-246-d): the rows and fold ids the Settings search hands to the pages.
import { expect, test } from "vitest";
import { searchAll } from "./searchMore";
import { foldsOf, launchRowsOf } from "./useSearchHits";

const agents = [{ id: "claude", name: "Claude" }, { id: "codex", name: "Codex" }];
const settings = { agentOptions: { claude: { command: "C:\\bin\\wrap.cmd", args: "--model opus", env: "TOKEN=abc" }, codex: { command: 5 } } };

test("SET-007: launch rows carry the saved command, arguments and environment of each agent, text only", () => {
  expect(launchRowsOf(agents, settings)).toEqual([
    { id: "claude", name: "Claude", command: "C:\\bin\\wrap.cmd", args: "--model opus", env: "TOKEN=abc" },
    { id: "codex", name: "Codex", command: undefined, args: undefined, env: undefined },
  ]);
  expect(launchRowsOf(agents, {})).toHaveLength(2);
});

test("SET-007: a launch-line search opens How it starts and keeps the Appearance folds in the same set", () => {
  const hits = searchAll("wrap", launchRowsOf(agents, settings))!;
  expect(hits.launch).toEqual(new Set(["claude"]));
  const folds = foldsOf(hits);
  expect(folds.has("how-it-starts")).toBe(true);
  const font = foldsOf(searchAll("terminal color", [])!);
  expect(font.has("terminal")).toBe(true);
});

test("SET-007: a search that matches no launch line opens no How it starts fold", () => {
  expect(foldsOf(searchAll("sound", launchRowsOf(agents, settings))!).has("how-it-starts")).toBe(false);
});
