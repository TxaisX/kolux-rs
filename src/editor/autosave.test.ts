import { describe, expect, it } from "vitest";
import { beginMove, covers, createAutosave, endMove, movingNow } from "./autosave";
import { readEditorPrefs } from "../settings/editorPrefs";

// EDIT-002 (T-177): autosave writes a pause after typing stops, never for the tabs the card
// excludes, and stands down while the banner is up or the file is being moved.
function rig(over: { autoSave?: boolean; delay?: number; covered?: boolean; dirty?: boolean; held?: boolean } = {}) {
  const st = { autoSave: over.autoSave ?? true, autoSaveDelay: over.delay ?? 1000, covered: over.covered ?? true, dirty: over.dirty ?? true, held: over.held ?? false };
  let now = 0;
  const jobs: { at: number; f: () => void; id: number }[] = [];
  let seq = 0;
  const timers = {
    set: (f: () => void, ms: number) => {
      const id = ++seq;
      jobs.push({ at: now + ms, f, id });
      return id;
    },
    clear: (t: unknown) => void jobs.splice(0, jobs.length, ...jobs.filter((j) => j.id !== t)),
  };
  const wrote: number[] = [];
  const a = createAutosave({ prefs: () => st, covered: () => st.covered, dirty: () => st.dirty, held: () => st.held, write: () => void wrote.push(now), timers });
  const tick = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = jobs.filter((j) => j.at <= end).sort((x, y) => x.at - y.at)[0];
      if (!next) break;
      jobs.splice(jobs.indexOf(next), 1);
      now = next.at;
      next.f();
    }
    now = end;
  };
  return { st, a, wrote, tick };
}

describe("which tabs autosave covers", () => {
  it("covers ordinary and unstaged-diff tabs, never staged, combined, conflict or read-only ones", () => {
    expect(covers({})).toBe(true);
    for (const k of ["readOnly", "staged", "combined", "conflict"] as const) expect(covers({ [k]: true })).toBe(false);
  });
});

describe("the pause", () => {
  it("a fresh profile has autosave off, so nothing is ever written", () => {
    const prefs = readEditorPrefs({});
    expect(prefs.autoSave).toBe(false);
    const r = rig({ autoSave: prefs.autoSave });
    r.a.edit();
    r.tick(60000);
    expect(r.wrote).toEqual([]);
  });

  it("writes once, the pause after the last edit", () => {
    const r = rig({ delay: 1000 });
    r.a.edit();
    r.tick(600);
    r.a.edit(); // typing again restarts the wait
    r.tick(999);
    expect(r.wrote).toEqual([]);
    r.tick(1);
    expect(r.wrote).toEqual([1600]);
    r.tick(10000);
    expect(r.wrote).toHaveLength(1);
  });

  it("uses the pause the user set, held to a quarter second..ten seconds, one second when unreadable", () => {
    expect(readEditorPrefs({ editorAutoSaveDelay: 5 }).autoSaveDelay).toBe(200);
    expect(readEditorPrefs({ editorAutoSaveDelay: 99999 }).autoSaveDelay).toBe(10000);
    expect(readEditorPrefs({ editorAutoSaveDelay: "soon" }).autoSaveDelay).toBe(1000);
    const r = rig({ delay: 2500 });
    r.a.edit();
    r.tick(2499);
    expect(r.wrote).toEqual([]);
    r.tick(1);
    expect(r.wrote).toHaveLength(1);
  });

  it("a setting switched off while a write waits stops that write at the next edit, and an uncovered tab never arms", () => {
    const off = rig({ covered: false });
    off.a.edit();
    expect(off.a.pending()).toBe(false);
    const r = rig();
    r.a.edit();
    r.st.autoSave = false;
    r.a.edit();
    r.tick(5000);
    expect(r.wrote).toEqual([]);
  });

  it("a clean tab is not written", () => {
    const r = rig({ dirty: false });
    r.a.edit();
    r.tick(5000);
    expect(r.wrote).toEqual([]);
  });
});

describe("standing down", () => {
  it("does not write while the changed-on-disk banner is up, and saves after the hold ends", () => {
    const r = rig({ held: true });
    r.a.edit();
    r.tick(5000);
    expect(r.wrote).toEqual([]);
    r.st.held = false; // Keep my edits
    r.a.resume();
    r.tick(1000);
    expect(r.wrote).toHaveLength(1);
  });

  it("resume does nothing for a tab with no unsaved text (Reload)", () => {
    const r = rig({ dirty: false });
    r.a.resume();
    expect(r.a.pending()).toBe(false);
  });

  it("cancel drops a pending write (the tab closes)", () => {
    const r = rig();
    r.a.edit();
    r.a.cancel();
    r.tick(5000);
    expect(r.wrote).toEqual([]);
  });

  it("a file mid-move is held, by either slash or case on Windows", () => {
    beginMove("C:\\w\\Note.md");
    expect(movingNow("c:/w/note.md")).toBe(true);
    endMove("C:/w/NOTE.md");
    expect(movingNow("C:/w/Note.md")).toBe(false);
  });
});

describe("the settings autosave reads", () => {
  it("are fetched again at an edit, at most every few seconds, so switching autosave on reaches open tabs", async () => {
    const { prefsReader } = await import("./autosave");
    let now = 0;
    let stored: Record<string, unknown> = {};
    let reads = 0;
    const r = prefsReader(async () => (reads++, stored), 5000, () => now);
    expect(r.get().autoSave).toBe(false);
    stored = { editorAutoSave: true, editorAutoSaveDelay: 2000 };
    await r.refresh();
    expect([r.get().autoSave, r.get().autoSaveDelay, reads]).toEqual([true, 2000, 1]);
    now = 1000;
    await r.refresh();
    expect(reads).toBe(1);
    now = 5000;
    stored = {};
    await r.refresh();
    expect([r.get().autoSave, reads]).toEqual([false, 2]);
  });
});
