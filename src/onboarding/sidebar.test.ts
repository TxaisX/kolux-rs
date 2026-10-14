import { describe, expect, it } from "vitest";
import { doneFrom, type Facts, type StepId } from "./guide";
import { checklistOf, OWN_FILE, type FirstRun } from "./newcomer";
import { entryLine, guideWanted, sidebarSlot } from "./sidebar";

const run = (more: Partial<FirstRun> = {}): FirstRun => ({ closed: true, outcome: "completed", checklistDismissed: false, milestones: {}, ...more });
const skipped = run({ outcome: "dismissed", checklistDismissed: true });
const CORE: StepId[] = ["notifications", "agent", "cli", "multitask", "automate", "repos"];
const facts = (more: Partial<Facts> = {}): Facts => ({ workspaces: [], gitProjects: 0, pageShown: false, integrations: "none", cli: false, notifications: false, agent: "", setupScript: false, ...more });

describe("the sidebar's onboarding slot (VIEW-114)", () => {
  it("shows nothing while the record is still being read, then the checklist when it is up", () => {
    expect(sidebarSlot(checklistOf(undefined, []), undefined, new Set())).toBe(null);
    const fresh = run();
    expect(sidebarSlot(checklistOf(fresh, []), fresh, new Set())).toBe("checklist");
    expect(guideWanted(checklistOf(fresh, []), fresh)).toBe(false);
  });

  it("after Skip and a folder: no flash while the guide's reads are out, then the Setup Guide entry", () => {
    const c = checklistOf(skipped, []);
    expect([c.show, guideWanted(c, skipped)]).toEqual([false, true]);
    expect(sidebarSlot(c, skipped, null)).toBe(null);
    expect(sidebarSlot(c, skipped, doneFrom(facts({ notifications: true })))).toBe("guide");
  });

  it("never shows while the wizard is still open; an older profile with no record gets the entry", () => {
    const open = run({ closed: false, outcome: null });
    expect(guideWanted(checklistOf(open, []), open)).toBe(false);
    expect(sidebarSlot(checklistOf(open, []), open, new Set())).toBe(null);
    expect(sidebarSlot(checklistOf(null, []), null, new Set())).toBe("guide");
  });

  it("with every core step done the entry never shows, not even once the reads answer", () => {
    const c = checklistOf(skipped, []);
    expect(sidebarSlot(c, skipped, new Set(CORE))).toBe(null);
    expect(sidebarSlot(c, skipped, new Set<StepId>([...CORE.slice(1), "browser", "integrations"]))).toBe("guide");
  });

  it("a finished checklist keeps the slot until it is dismissed, then the entry takes it", () => {
    const all = run({ milestones: { aiConnected: 1, kitLaunched: 2, resultsOpened: 3 } });
    const c = checklistOf(all, [OWN_FILE]);
    expect(c.show).toBe(true);
    expect(sidebarSlot(c, all, new Set())).toBe("checklist");
    const gone = run({ ...all, checklistDismissed: true });
    expect(sidebarSlot(checklistOf(gone, [OWN_FILE]), gone, new Set())).toBe("guide");
  });

  it("adding a project ticks its step in the entry: one git project leaves Multiple repos open, the second ticks it", () => {
    const one = entryLine(doneFrom(facts({ gitProjects: 1, notifications: true })));
    const two = entryLine(doneFrom(facts({ gitProjects: 2, notifications: true })));
    expect([one.done, one.total, two.done, two.total]).toEqual([1, 6, 2, 6]);
    expect(one.count).toBe("1 of 6");
    expect(one.nextId).toBe("agent");
    const last = entryLine(new Set<StepId>(["notifications", "agent", "cli", "multitask", "automate"]));
    expect([last.nextId, last.next]).toEqual(["repos", "Start work in multiple repos"]);
  });
});
