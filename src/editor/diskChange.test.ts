import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { attach, detach, hashOf, isDirty, type View } from "./buffers";
import { bannerUp, beginSave, canUndo, checkOnce, endSave, forget, keep, readFresh, goneText, reloadNow, remember, sameStamp, verdict, type Io, type Stamp } from "./diskChange";

// EDIT-003 (T-073): the disk-change check behind the banner. The stamp (modified time + size) is
// advisory; the save's hash check (T-073-a) is the guard, and the last block proves it still
// refuses when the stamp cannot tell.
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
const { saveFile } = await import("./EditorPane");

const P = "C:/w/disk-change.ts";
const s = (mtime: number, size: number): Stamp => ({ mtime, size });
afterEach(() => {
  forget(P);
  invoke.mockReset();
});

function io(over: Partial<Io> & { disk?: { text: string; stamp: Stamp | null } } = {}): Io & { applied: [string, boolean][]; disk: { text: string; stamp: Stamp | null } } {
  const disk = over.disk ?? { text: "disk\n", stamp: s(2, 5) };
  const applied: [string, boolean][] = [];
  return { stamp: async () => disk.stamp, read: async () => disk.text, dirty: () => false, current: () => "mine\n", apply: (t, u) => void applied.push([t, u]), ...over, applied, disk };
}

describe("stamps", () => {
  it("compares modified time and size, and a missing file only with a missing file", () => {
    expect(sameStamp(s(1, 4), s(1, 4))).toBe(true);
    expect(sameStamp(s(1, 4), s(2, 4))).toBe(false);
    expect(sameStamp(s(1, 4), s(1, 5))).toBe(false);
    expect(sameStamp(null, null)).toBe(true);
    expect(sameStamp(s(1, 4), null)).toBe(false);
  });
});

describe("verdict (EDIT-003 rules)", () => {
  it("does nothing before the tab has loaded, or while the stamp is the known one", () => {
    expect(verdict(P, s(2, 5), true)).toBe("none");
    remember(P, s(1, 4));
    expect(verdict(P, s(1, 4), true)).toBe("none");
  });
  it("a tab without unsaved edits reloads quietly; one with edits gets the banner", () => {
    remember(P, s(1, 4));
    expect(verdict(P, s(2, 5), false)).toBe("reload");
    expect(verdict(P, s(2, 5), true)).toBe("banner");
  });
  it("Kolux's own save remembers the stamp it wrote, so it never raises the banner", () => {
    remember(P, s(1, 4));
    remember(P, s(3, 9)); // what file_write answered after the app's own Mod+S
    expect(verdict(P, s(3, 9), true)).toBe("none");
  });
  it("Keep my edits hides the banner until the file changes again", () => {
    remember(P, s(1, 4));
    keep(P, s(2, 5));
    expect(verdict(P, s(2, 5), true)).toBe("none");
    expect(verdict(P, s(4, 5), true)).toBe("banner");
  });
  it("a file that is gone raises nothing (the save's check still refuses)", () => {
    remember(P, s(1, 4));
    expect(verdict(P, null, true)).toBe("none");
  });
});

describe("reads", () => {
  it("an earlier read that finishes late is thrown away", async () => {
    let release!: (t: string) => void;
    const slow = readFresh(P, async () => s(1, 4), () => new Promise<string>((r) => (release = r)));
    const fast = await readFresh(P, async () => s(2, 5), async () => "newer\n");
    release("older\n");
    expect(fast).toEqual({ text: "newer\n", stamp: s(2, 5) });
    expect(await slow).toBeNull();
  });
  it("Reload always fetches fresh and overtakes a quiet reload already under way", async () => {
    remember(P, s(1, 4));
    let release!: (t: string) => void;
    let reads = 0;
    const quiet = io({ read: () => (reads++, new Promise<string>((r) => (release = r))) });
    const pending = checkOnce(P, quiet, () => undefined);
    await vi.waitFor(() => expect(reads).toBe(1));
    const loud = io({ disk: { text: "fresh\n", stamp: s(2, 5) } });
    const undo = await reloadNow(P, loud);
    release("stale\n");
    await pending;
    expect(loud.applied).toEqual([["fresh\n", true]]);
    expect(quiet.applied).toEqual([]);
    expect(undo).toEqual({ path: P, before: "mine\n", after: "fresh\n" });
  });
});

describe("checkOnce", () => {
  it("a clean tab takes the disk copy quietly and remembers its stamp", async () => {
    remember(P, s(1, 4));
    const t = io();
    expect(await checkOnce(P, t, () => undefined)).toBe("reload");
    expect(t.applied).toEqual([["disk\n", false]]);
    expect(verdict(P, s(2, 5), true)).toBe("none");
  });
  it("a tab with edits keeps its text, raises the banner and holds autosave", async () => {
    remember(P, s(1, 4));
    const t = io({ dirty: () => true });
    const raised = vi.fn();
    expect(await checkOnce(P, t, raised)).toBe("banner");
    expect(t.applied).toEqual([]);
    expect(raised).toHaveBeenCalledWith(s(2, 5));
    expect(bannerUp(P)).toBe(true);
    await reloadNow(P, t);
    expect(bannerUp(P)).toBe(false);
  });
  // T-073-e (council MERGE 33 A1): Kolux's own save is in flight, the disk already carries the new
  // stamp but the buffer is still dirty until the write answers; a poll landing then must not flash.
  it("a check that runs while the tab's own save is still writing gives none, not the banner", async () => {
    remember(P, s(1, 4));
    const t = io({ dirty: () => true });
    const raised = vi.fn();
    beginSave(P);
    expect(await checkOnce(P, t, raised)).toBe("none");
    expect(raised).not.toHaveBeenCalled();
    expect(bannerUp(P)).toBe(false);
    endSave(P);
    expect(await checkOnce(P, t, raised)).toBe("banner");
  });
  // T-073-e (council MERGE 33 A2): bannerUp must not stick once the verdict is no longer "banner"
  // (the file put back, or the tab cleaned up), because T-177 autosave reads it.
  it("a verdict of none or reload takes the banner flag down again", async () => {
    remember(P, s(1, 4));
    const dirty = { v: true };
    const t = io({ dirty: () => dirty.v });
    expect(await checkOnce(P, t, () => undefined)).toBe("banner");
    expect(bannerUp(P)).toBe(true);
    t.disk.stamp = s(1, 4);
    expect(await checkOnce(P, t, () => undefined)).toBe("none");
    expect(bannerUp(P)).toBe(false);
    t.disk.stamp = s(3, 6);
    expect(await checkOnce(P, t, () => undefined)).toBe("banner");
    expect(bannerUp(P)).toBe(true);
    dirty.v = false;
    t.disk.stamp = s(4, 7);
    expect(await checkOnce(P, t, () => undefined)).toBe("reload");
    expect(bannerUp(P)).toBe(false);
  });
});

describe("undo entry", () => {
  it("the toast's Undo applies only while the buffer still holds what Reload brought in", () => {
    const u = { path: P, before: "mine\n", after: "disk\n" };
    expect(canUndo(u, "disk\n")).toBe(true);
    expect(canUndo(u, "disk\ntyped")).toBe(false);
    expect(canUndo(null, "disk\n")).toBe(false);
    expect(canUndo({ ...u, before: "disk\n" }, "disk\n")).toBe(false);
  });
});

describe("council: the banner is advisory, the save's hash check is the guard", () => {
  it("stamp unchanged, content changed: the check stays quiet, the save is refused and the choice shows", async () => {
    const v: View = { state: EditorState.create({ doc: "aaaa\n" }), dispatch: (spec) => void (v.state = v.state.update({ changes: spec.changes }).state) };
    attach(P, v, "aaaa\n");
    remember(P, s(1, 5));
    v.dispatch({ changes: { from: 0, to: 4, insert: "mine" }, annotations: undefined as never });
    // An agent rewrote the file to "bbbb\n" (same size) and put the old modified time back.
    expect(verdict(P, s(1, 5), isDirty(P))).toBe("none");
    invoke.mockRejectedValue({ kind: "stale", message: "changed on disk", diskHash: await hashOf("bbbb\n") });
    const stale = vi.fn();
    const toast = vi.fn();
    await saveFile(P, stale, toast);
    expect(invoke).toHaveBeenCalledWith("file_write", { path: P, text: "mine\n", loadedHash: await hashOf("aaaa\n") });
    expect(stale).toHaveBeenCalledWith(true); // EditorPane shows StaleNotice: Reload / Keep mine
    expect(toast).not.toHaveBeenCalled();
    expect(isDirty(P)).toBe(true);
    detach(P, v);
  });
});

describe("what the tab shows (EDIT-003)", async () => {
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { DiskBanner, UndoToast } = await import("./DiskBanner");
  const { StaleNotice } = await import("./EditorPane");
  const noop = () => undefined;
  it("the banner offers Reload, Keep my edits and Compare", () => {
    const html = renderToString(createElement(DiskBanner, { path: P, onReload: noop, onKeep: noop, onCompare: noop }));
    expect(html).toContain("disk-change.ts changed on disk");
    for (const b of ["Reload", "Keep my edits", "Compare"]) expect(html).toContain(`>${b}</button>`);
  });
  it("the toast after a Reload offers Undo", () => {
    expect(renderToString(createElement(UndoToast, { path: P, onUndo: noop, onClose: noop }))).toContain(">Undo</button>");
  });
  it("a refused save shows Reload / Keep mine (the guard's choice, council)", () => {
    const html = renderToString(createElement(StaleNotice, { path: P, onDone: noop }));
    expect(html).toContain(">Reload</button>");
    expect(html).toContain(">Keep mine</button>");
  });
});

describe("EDIT-032: a tab whose file is gone", () => {
  it("says the file was deleted or moved and that the text is kept", () => {
    expect(goneText("plan.md")).toContain("plan.md was deleted or moved away");
    expect(goneText("plan.md")).toContain("Your text is still here");
  });
  it("is not a reload or a banner: a missing file never overwrites the tab", () => {
    remember("C:/w/gone.md", { mtime: 1, size: 2 });
    expect(verdict("C:/w/gone.md", null, true)).toBe("none");
    expect(verdict("C:/w/gone.md", null, false)).toBe("none");
    forget("C:/w/gone.md");
  });
});
