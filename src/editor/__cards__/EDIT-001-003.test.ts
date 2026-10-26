// EDIT-001 boxes 1, 3, 4 and EDIT-003 boxes 1, 2, 4 with the REAL buffers, disk-change and panel modules over real files
// under the scratch root G:\Temp\cards-v3\edit12\ (node fs stands in for the file commands; the Rust side is cards_12.rs).
// MIRROR src/editor/EditorPane.tsx:445 (setInterval(check, POLL_MS) calls checkOnce), EditorPane.tsx:462-480 (reload / undoReload),
// EditorPane.tsx:826 (Retry button bumps `tries`), src/floating/FloatingLayer.tsx:140 and src/App.tsx:661 (Mod+S handlers).
import { history, undo } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { afterAll, describe, expect, test } from "vitest";
import { attach, detach, hashOf, isDirty, loadText, relay, replaceAll, save, textOf, type View } from "../buffers";
import { beginSave, canUndo, checkOnce, endSave, forget, POLL_MS, reloadNow, remember, type Io, type Stamp } from "../diskChange";
import { editors } from "../EditorPane";
import { add, empty, KEY_BASE, route, saveTarget } from "../../floating/panel";

// The repo has no node typings, so node's fs is loaded by name and typed here.
type Fs = {
  mkdirSync(p: string, o?: { recursive: boolean }): void;
  readFileSync(p: string, enc: string): string;
  rmSync(p: string, o?: { recursive: boolean; force: boolean }): void;
  statSync(p: string): { mtimeMs: number; size: number };
  utimesSync(p: string, a: Date, b: Date): void;
  writeFileSync(p: string, t: string): void;
};
const fsName = "node:fs";
const { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } = (await import(/* @vite-ignore */ fsName)) as unknown as Fs;

const ROOT = "G:/Temp/cards-v3/edit12";
const dir = `${ROOT}/ts-${Date.now()}`;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/.kolux-rs-scratch`, "");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const stampOf = (p: string): Stamp => {
  const s = statSync(p);
  return { mtime: Math.floor(s.mtimeMs), size: s.size };
};

function fakeView(path: string, text: string): View & { type: (at: number, s: string) => void } {
  const v = {
    state: EditorState.create({ doc: text, extensions: [history()] }),
    dispatch(spec: Parameters<View["dispatch"]>[0]) {
      const tr: Transaction = v.state.update(spec);
      v.state = tr.state;
      relay(path, v, tr);
    },
    type(at: number, s: string) {
      v.dispatch({ changes: { from: at, to: at, insert: s }, annotations: [] });
    },
  };
  return v;
}

/** The file commands over node fs, with the hash guard file_write has. */
const write = (p: string) => async (text: string, loadedHash?: string) => {
  if (loadedHash !== undefined && (await hashOf(readFileSync(p, "utf8"))) !== loadedHash) throw new Error("stale");
  writeFileSync(p, text);
};

describe("EDIT-001", () => {
  test("box 1: one typed character shows the unsaved marker; Mod+S clears it and the character is on disk", async () => {
    const p = `${dir}/main.rs`;
    writeFileSync(p, "fn main() {}\n");
    const disk = await loadText(async () => readFileSync(p, "utf8"));
    const v = fakeView(p, disk);
    attach(p, v, disk);
    expect(isDirty(p)).toBe(false);
    v.type(0, "x");
    expect(isDirty(p)).toBe(true); // the marker is isDirty(path): App.tsx onDirty -> tab header
    await save(p, write(p));
    expect(isDirty(p)).toBe(false);
    expect(readFileSync(p, "utf8")).toBe("xfn main() {}\n");
    detach(p, v);
  });

  test("box 3: with a floating editor active, Mod+S writes only the floating editor's file", async () => {
    const a = `${dir}/main-editor.ts`;
    const b = `${dir}/floating-note.md`;
    writeFileSync(a, "main\n");
    writeFileSync(b, "note\n");
    const va = fakeView(a, "main\n");
    const vb = fakeView(b, "note\n");
    attach(a, va, "main\n");
    attach(b, vb, "note\n");
    va.type(0, "MAIN ");
    vb.type(0, "NOTE ");
    const panel = add(empty(), { kind: "markdown", path: b });
    const floatKey = panel.active as number;
    expect(floatKey).toBeGreaterThanOrEqual(KEY_BASE);
    const mainKey = 7;
    editors.set(mainKey, () => save(a, write(a)));
    editors.set(floatKey, () => save(b, write(b)));
    // the key goes to the floating layer first: panel open, focus inside it
    expect(route("editor.save", undefined, true, true)).toEqual({ op: "save" });
    const key = saveTarget(panel, true);
    expect(key).toBe(floatKey);
    await editors.get(key as number)?.();
    expect(readFileSync(b, "utf8")).toBe("NOTE note\n");
    expect(readFileSync(a, "utf8")).toBe("main\n"); // the main editor's file is untouched, still unsaved
    expect(isDirty(a)).toBe(true);
    // contrast: focus in the main window, the panel hands the key back and the main editor saves
    expect(route("editor.save", undefined, true, false)).toBeNull();
    expect(saveTarget(panel, false)).toBeNull();
    await editors.get(mainKey)?.();
    expect(readFileSync(a, "utf8")).toBe("MAIN main\n");
    editors.delete(mainKey);
    editors.delete(floatKey);
    detach(a, va);
    detach(b, vb);
  });

  test("box 4: an unreadable file fails after a limited number of tries with the reason; Retry loads it once access is back", async () => {
    let denied = true;
    let reads = 0;
    const read = async () => {
      reads++;
      if (denied) throw new Error("Access is denied. (os error 5)");
      return "text is back\n";
    };
    await expect(loadText(read, 3, 1)).rejects.toThrow("Access is denied");
    expect(reads).toBe(3); // limited, not endless
    denied = false;
    expect(await loadText(read, 3, 1)).toBe("text is back\n"); // Retry = the same load run again
  });
});

describe("EDIT-003", () => {
  const ioFor = (p: string): Io => ({
    stamp: async () => stampOf(p),
    read: async () => readFileSync(p, "utf8"),
    dirty: () => isDirty(p),
    current: () => textOf(p),
    apply: (t, undoable) => replaceAll(p, t, undoable),
  });

  test("box 1: unsaved edits, then the file is changed from outside: the next check (every POLL_MS, at most 2 s) raises the banner", async () => {
    expect(POLL_MS).toBeLessThanOrEqual(2000);
    const p = `${dir}/watch.md`;
    writeFileSync(p, "disk one\n");
    const v = fakeView(p, "disk one\n");
    attach(p, v, "disk one\n");
    remember(p, stampOf(p));
    v.type(0, "mine ");
    const io = ioFor(p);
    const raised: (Stamp | null)[] = [];
    expect(await checkOnce(p, io, (s) => raised.push(s))).toBe("none"); // nothing changed yet
    writeFileSync(p, "disk one, rewritten by an agent\n");
    expect(await checkOnce(p, io, (s) => raised.push(s))).toBe("banner");
    expect(raised).toHaveLength(1);
    expect(textOf(p)).toBe("mine disk one\n"); // the edits are untouched
    detach(p, v);
    forget(p);
  });

  test("box 2: Reload makes the buffer match disk and offers undo; undo brings the edits back", async () => {
    const p = `${dir}/reload.md`;
    writeFileSync(p, "disk one\n");
    const v = fakeView(p, "disk one\n");
    attach(p, v, "disk one\n");
    remember(p, stampOf(p));
    v.type(0, "mine ");
    writeFileSync(p, "agent version\n");
    const u = await reloadNow(p, ioFor(p));
    expect(u).not.toBeNull();
    expect(textOf(p)).toBe("agent version\n"); // buffer matches disk
    expect(isDirty(p)).toBe(false);
    expect(canUndo(u, textOf(p))).toBe(true); // the toast's Undo is offered
    undo(v as never); // undoReload(): undo(cm)
    expect(textOf(p)).toBe("mine disk one\n"); // the edits are back
    detach(p, v);
    forget(p);
  });

  test("box 4: saving from Kolux raises no banner, even when a check lands mid-save; an outside rewrite afterwards does", async () => {
    const p = `${dir}/own-save.md`;
    writeFileSync(p, "one\n");
    const v = fakeView(p, "one\n");
    attach(p, v, "one\n");
    remember(p, stampOf(p));
    v.type(3, "two\n");
    const io = ioFor(p);
    beginSave(p);
    await save(p, write(p));
    expect(await checkOnce(p, io, () => expect.fail("banner during own save"))).toBe("none"); // poll between write and remember
    remember(p, stampOf(p));
    endSave(p);
    expect(await checkOnce(p, io, () => expect.fail("banner after own save"))).toBe("none");
    v.type(0, "more ");
    const old = new Date(Date.now() - 60_000);
    writeFileSync(p, "one\ntwo\nagent line\n");
    utimesSync(p, old, old);
    let banners = 0;
    expect(await checkOnce(p, io, () => banners++)).toBe("banner");
    expect(banners).toBe(1);
    detach(p, v);
    forget(p);
  });
});
