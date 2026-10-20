import { describe, expect, it } from "vitest";
import { losable, quitQuestion, runningAgents } from "./closeAsk";

const panes = [
  { key: 1, agent: "claude", title: "Fix login" },
  { key: 2, agent: "shell" },
  { key: 3, agent: "codex", word: "otter" },
  { key: 4, agent: "claude", kind: "editor" },
  { key: 5, agent: "claude", title: "Done one" },
];

describe("T-182 APP-006: closing asks first when work could be lost", () => {
  it("counts agent panes still running or starting, never shells, editors or ended agents", () => {
    // 1 running, 2 a shell (even if busy), 3 still starting (undefined), 4 an editor tab, 5 ended.
    expect(runningAgents(panes, { 1: true, 2: true, 5: false }, true)).toEqual(["Fix login", "otter"]);
  });
  it("counts nothing while the ask is switched off", () => {
    expect(runningAgents(panes, { 1: true }, false)).toEqual([]);
  });
  it("closes at once when nothing would be lost", () => {
    expect(losable([], [])).toBeNull();
    expect(losable(["a.ts"], [])).toEqual({ files: ["a.ts"], agents: [] });
    expect(losable([], ["otter"])).toEqual({ files: [], agents: ["otter"] });
  });
  it("words the question for files, for agents, and for both", () => {
    const files = quitQuestion({ files: ["a.ts"], agents: [] });
    expect(files.title).toBe("Quit with unsaved changes?");
    expect(files.body).toBe("1 file has unsaved changes: a.ts. Quitting now loses them.");
    expect(files.confirm).toBe("Quit without saving");
    const agents = quitQuestion({ files: [], agents: ["Fix login", "otter"] });
    expect(agents.title).toBe("Quit while agents are running?");
    expect(agents.body).toBe("2 agents are still running: Fix login, otter. Quitting now stops them.");
    expect(agents.confirm).toBe("Quit and stop them");
    const one = quitQuestion({ files: [], agents: ["otter"] });
    expect(one.body).toBe("1 agent is still running: otter. Quitting now stops it.");
    const both = quitQuestion({ files: ["a.ts", "b.ts"], agents: ["otter"] });
    expect(both.title).toBe("Quit with unsaved changes?");
    expect(both.body).toBe("2 files have unsaved changes: a.ts, b.ts. Quitting now loses them. 1 agent is still running: otter. Quitting now stops it.");
  });
});
