import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutosave } from "./autosave";
import { bannerUp, checkOnce, forget, holdRestored, keep, reloadNow, remember, verdict, type Io, type Stamp } from "./diskChange";
import { restoreFrom } from "./drafts";
import { hashOf } from "./buffers";

// T-073-d (EDIT-003 rest): autosave holds while the changed-on-disk banner is up, and a draft that
// comes back after a restart is held with the banner until the user answers. These tests wire the
// real autosave to the real disk-change state the way EditorPane does (held = bannerUp), with
// fake timers and a fake disk.
const P = "C:/w/hold.md";
const s = (mtime: number, size: number): Stamp => ({ mtime, size });
afterEach(() => forget(P));

function rig(dirtyAtStart = true) {
  let now = 0;
  const jobs: { at: number; f: () => void; id: number }[] = [];
  let seq = 0;
  const timers = {
    set: (f: () => void, ms: number) => (jobs.push({ at: now + ms, f, id: ++seq }), seq),
    clear: (t: unknown) => void jobs.splice(0, jobs.length, ...jobs.filter((j) => j.id !== t)),
  };
  const st = { dirty: dirtyAtStart, wrote: 0, disk: { text: "disk\n", stamp: s(2, 5) } };
  const io: Io = { stamp: async () => st.disk.stamp, read: async () => st.disk.text, dirty: () => st.dirty, current: () => "mine\n", apply: () => (st.dirty = false) };
  const a = createAutosave({
    prefs: () => ({ autoSave: true, autoSaveDelay: 1000 }),
    covered: () => true,
    dirty: () => st.dirty,
    held: () => bannerUp(P),
    write: () => void st.wrote++,
    timers,
  });
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
  return { st, io, a, tick };
}

describe("an outside write under unsaved edits", () => {
  it("raises the banner and no autosave lands until Keep, which then saves after the pause", async () => {
    remember(P, s(1, 4));
    const r = rig();
    r.a.edit();
    r.st.disk.stamp = s(3, 6); // someone else wrote the file before the pause ended
    expect(await checkOnce(P, r.io, () => undefined)).toBe("banner");
    r.tick(5000);
    expect(r.st.wrote).toBe(0); // the pause ended with the banner up: stood down
    r.a.edit(); // more typing while the banner is up still writes nothing
    r.tick(5000);
    expect(r.st.wrote).toBe(0);
    keep(P, s(3, 6));
    r.a.resume(); // EditorPane calls this when the banner goes
    r.tick(999);
    expect(r.st.wrote).toBe(0);
    r.tick(1);
    expect(r.st.wrote).toBe(1);
  });

  it("Reload brings the disk copy in, leaves the tab clean, and autosave has nothing to write", async () => {
    remember(P, s(1, 4));
    const r = rig();
    r.a.edit();
    r.st.disk.stamp = s(3, 6);
    await checkOnce(P, r.io, () => undefined);
    expect(bannerUp(P)).toBe(true);
    await reloadNow(P, r.io);
    expect(bannerUp(P)).toBe(false);
    r.a.resume();
    r.tick(5000);
    expect(r.st.wrote).toBe(0);
  });

  it("the hold lifts by itself when the file is put back as it was", async () => {
    remember(P, s(1, 4));
    const r = rig();
    r.st.disk.stamp = s(3, 6);
    await checkOnce(P, r.io, () => undefined);
    expect(bannerUp(P)).toBe(true);
    r.st.disk.stamp = s(1, 4);
    expect(await checkOnce(P, r.io, () => undefined)).toBe("none");
    expect(bannerUp(P)).toBe(false);
    r.a.edit();
    r.tick(1000);
    expect(r.st.wrote).toBe(1);
  });
});

describe("a draft restored after a restart", () => {
  const open = async (diskText: string, draftOver: string) => {
    const draft = { path: P, text: "typed\n", base: await hashOf(draftOver) };
    const r = restoreFrom(diskText, await hashOf(diskText), draft);
    // what the tab does once the buffer is built: it remembers the disk stamp it just read
    remember(P, s(9, 9));
    if (r.moved) holdRestored(P);
    return r;
  };

  it("over a disk copy that changed is compared first: banner up at once, no autosave, and the first check keeps it", async () => {
    const r0 = await open("new from outside\n", "old\n");
    expect(r0.moved).toBe(true);
    expect(bannerUp(P)).toBe(true);
    const r = rig();
    r.a.resume(); // the tab resumes autosave after building the editor, as EditorPane does
    r.tick(5000);
    expect(r.st.wrote).toBe(0);
    r.st.disk.stamp = s(9, 9); // nothing further changed on disk: the stamp equals the one just read
    expect(verdict(P, s(9, 9), true)).toBe("banner");
    expect(await checkOnce(P, r.io, () => undefined)).toBe("banner");
    expect(bannerUp(P)).toBe(true);
    r.tick(5000);
    expect(r.st.wrote).toBe(0);
  });

  it("Keep my edits ends the hold and the draft then saves; Reload ends it too", async () => {
    await open("new from outside\n", "old\n");
    keep(P, s(9, 9));
    expect(bannerUp(P)).toBe(false);
    expect(verdict(P, s(9, 9), true)).toBe("none");
    await open("new from outside\n", "old\n");
    const r = rig();
    r.st.disk.stamp = s(9, 9);
    await reloadNow(P, r.io);
    expect(bannerUp(P)).toBe(false);
    expect(verdict(P, s(9, 9), true)).toBe("none");
  });

  it("over a disk copy that did not change is not held, and typing it back to the disk copy lets go", async () => {
    const same = await open("disk\n", "disk\n");
    expect(same.moved).toBe(false);
    expect(bannerUp(P)).toBe(false);
    await open("changed\n", "disk\n");
    const clean = vi.fn(() => false);
    expect(await checkOnce(P, { stamp: async () => s(9, 9), read: async () => "", dirty: clean, current: () => "", apply: () => undefined }, () => undefined)).toBe("none");
    expect(bannerUp(P)).toBe(false);
  });
});
