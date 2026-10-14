import { describe, expect, it } from "vitest";
import { doneFrom, type Facts, type StepId } from "./guide";
import { checklistOf, OWN_FILE, type FirstRun } from "./newcomer";
import { entryLine, FOCUS_FLOOR_MS, guideWanted, onReread, PROJECT_ADDED, sidebarSlot } from "./sidebar";
import { GUIDE_CLOSED } from "./guide";

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

  it("after Skip: sidebarSlot gives nothing while the guide's done set is still unread (null), then the Setup Guide entry (the pure slot; the hook's settled snapshot is not covered here)", () => {
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

  it("entryLine counts git projects: one leaves Multiple repos open, the second ticks it (the words only; the re-read on an add is the onReread test)", () => {
    const one = entryLine(doneFrom(facts({ gitProjects: 1, notifications: true })));
    const two = entryLine(doneFrom(facts({ gitProjects: 2, notifications: true })));
    expect([one.done, one.total, two.done, two.total]).toEqual([1, 6, 2, 6]);
    expect(one.count).toBe("1 of 6");
    expect(one.nextId).toBe("agent");
    const last = entryLine(new Set<StepId>(["notifications", "agent", "cli", "multitask", "automate"]));
    expect([last.nextId, last.next]).toEqual(["repos", "Start work in multiple repos"]);
  });
});

describe("when the sidebar entry reads its steps again (VIEW-114, FIX-2)", () => {
  it("every Setup Guide close and every added project re-reads; window focus re-reads at most once per floor; the cleanup stops all three", () => {
    const target = new EventTarget();
    let now = 100_000;
    let bumps = 0;
    const stop = onReread(target, () => bumps++, () => now);
    target.dispatchEvent(new Event("focus"));
    target.dispatchEvent(new Event("focus"));
    expect(bumps).toBe(1);
    now += FOCUS_FLOOR_MS;
    target.dispatchEvent(new Event("focus"));
    expect(bumps).toBe(2);
    target.dispatchEvent(new Event(GUIDE_CLOSED));
    target.dispatchEvent(new Event(GUIDE_CLOSED));
    target.dispatchEvent(new Event(PROJECT_ADDED));
    expect(bumps).toBe(5);
    stop();
    now += FOCUS_FLOOR_MS;
    for (const t of ["focus", GUIDE_CLOSED, PROJECT_ADDED]) target.dispatchEvent(new Event(t));
    expect(bumps).toBe(5);
  });
});
