import { describe, expect, it } from "vitest";
import { caps, completed, firstOpen, forward, milestonesShown, moveOn, nextTip, railKey, ring, startTicked, STEPS, stopOf, WORKFLOWS, type StepId } from "./guide";

const set = (...ids: StepId[]) => new Set<StepId>(ids);

describe("Setup Guide (ONB-014)", () => {
  it("has eight steps, the Setup group before the parallel-work group", () => {
    expect(STEPS).toHaveLength(8);
    const groups = STEPS.map((s) => s.group);
    expect(groups.lastIndexOf("setup")).toBeLessThan(groups.indexOf("parallel"));
    expect(STEPS.every((s) => s.ko.name && s.ko.about && s.en.name && s.en.about)).toBe(true);
  });

  it("opens on the first unfinished step, Setup first, or on the step asked for", () => {
    expect(firstOpen(set())).toBe("notifications");
    expect(firstOpen(set("notifications", "agent"))).toBe("cli");
    const setupDone = set(...STEPS.filter((s) => s.group === "setup").map((s) => s.id));
    expect(firstOpen(setupDone)).toBe("multitask");
    expect(firstOpen(set(), "repos")).toBe("repos");
    expect(firstOpen(set(...STEPS.map((s) => s.id)))).toBe("notifications");
  });

  it("moves on once the step showing is done", () => {
    expect(moveOn("cli", set())).toBe("cli");
    expect(moveOn("cli", set("cli"))).toBe("browser");
    expect(moveOn("repos", set("repos"))).toBe("notifications");
    const all = set(...STEPS.map((s) => s.id));
    expect(moveOn("cli", all)).toBe("cli");
  });

  it("counts core steps in the ring and drops Milestones once they are all done", () => {
    expect(ring(set())).toEqual({ done: 0, total: 6 });
    const core = STEPS.filter((s) => s.core).map((s) => s.id);
    expect(milestonesShown(set(...core.slice(1)))).toBe(true);
    expect(milestonesShown(set(...core))).toBe(false);
    expect(ring(set("browser"))).toEqual({ done: 0, total: 6 });
  });
});

describe("CLI step (ONB-017)", () => {
  it("starts only the missing capabilities ticked", () => {
    const c = caps({ installed: true, onPath: true }, ["pdf"]);
    expect(startTicked(c)).toEqual(["kolux-cli", "orchestration"]);
    expect(startTicked(caps({ installed: true, onPath: false }, ["kolux-cli", "orchestration"]))).toEqual(["command"]);
    expect(startTicked(caps(null, []))).toEqual(["command", "kolux-cli", "orchestration"]);
  });
});

describe("Explore Kolux (ONB-022)", () => {
  it("opens on workspaces with five workflows on the rail", () => {
    expect(WORKFLOWS.map((w) => w.id)).toEqual(["workspaces", "tasks", "agents", "workbench", "review"]);
    expect(stopOf({ w: 0, s: -1 }).id).toBe("workspaces");
  });

  it("Continue visits a workflow's stops before the next workflow", () => {
    const seen: string[] = [];
    let at: ReturnType<typeof forward> = { w: 2, s: -1 };
    for (let i = 0; i < 4 && at; i++) {
      at = forward(at);
      if (at) seen.push(stopOf(at).id);
    }
    expect(seen).toEqual(["statuses", "usage", "orchestration", "workbench"]);
    expect(forward({ w: 4, s: 2 })).toBeNull();
  });

  it("the rail answers arrows, Home and End and stops at both ends", () => {
    expect(railKey("End", 0)).toBe(4);
    expect(railKey("Home", 3)).toBe(0);
    expect(railKey("ArrowDown", 4)).toBe(4);
    expect(railKey("ArrowUp", 0)).toBe(0);
    expect(railKey("a", 1)).toBeNull();
  });

  it("a workflow is Completed once it and its required stops were visited", () => {
    const agents = WORKFLOWS[2];
    expect(completed(agents, new Set(["agents"]))).toBe(false);
    expect(completed(agents, new Set(["agents", "statuses"]))).toBe(true);
  });
});

describe("startup tips (ONB-027)", () => {
  const none = { seen: [], tried: [], cli: { installed: false, onPath: false }, onboarding: false };
  it("shows the CLI tip, then the palette tip, then nothing", () => {
    expect(nextTip(none)).toBe("cli");
    expect(nextTip({ ...none, seen: ["cli"] })).toBe("palette");
    expect(nextTip({ ...none, seen: ["cli", "palette"] })).toBeNull();
  });
  it("skips the CLI tip when it is on PATH or its status cannot be read, but not when only installed", () => {
    expect(nextTip({ ...none, cli: { installed: true, onPath: true } })).toBe("palette");
    expect(nextTip({ ...none, cli: "error" })).toBe("palette");
    expect(nextTip({ ...none, cli: { installed: true, onPath: false } })).toBe("cli");
  });
  it("shows nothing in a session that showed the first run, and skips a feature already in use", () => {
    expect(nextTip({ ...none, onboarding: true })).toBeNull();
    expect(nextTip({ ...none, seen: ["cli"], tried: ["palette"] })).toBeNull();
  });
});
