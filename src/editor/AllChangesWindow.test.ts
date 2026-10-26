// Row 837 (stress run S10): All Changes with ~2.5k changed files must mount only the sections
// near the viewport, keep the view steady as sections are measured, and not re-render the whole
// list when a section finishes drawing. The node test environment has no DOM, so scrolling is
// simulated through the same geometry the list uses (sectionWindow.ts) and the mounted sections
// are counted from the server-rendered HTML of the real components.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AllChangesList, Section, entryKey, estimate, type Entry } from "./AllChangesPane";
import { treeRows, TREE_ROW } from "./ChangeTree";
import { windowRange } from "../scm/rules";
import { anchoredScroll, FALLBACK_VIEWPORT, indexAt, layoutOf, readyStore, SECTION_CHROME, SECTION_GAP, sliceOf } from "./sectionWindow";

const COUNT = 2500;
const entries: Entry[] = Array.from({ length: COUNT }, (_, i) => ({ path: `C:/r/dir${i % 50}/f${String(i).padStart(4, "0")}.ts`, staged: false, code: "M", lines: 5 + (i % 60), binary: false, stamp: `s${i}` }));
const heights = entries.map((e) => SECTION_CHROME + estimate(e));
const layout = layoutOf(heights);
const ORIGIN = 8; // the list's padding, where the section column starts

const sectionsIn = (html: string) => (html.match(/class="ac-section"/g) ?? []).length;
const listProps = (initialTop = 0) => ({ entries, root: "C:/r", base: null, draw: { split: false, wrap: false, spaces: false }, cache: new Map(), ready: readyStore(), fold: {}, viewed: {}, hidden: false, idPrefix: "ac-1", jumpRef: { current: null }, loaded: new Set<string>(), onFocusView: () => undefined, onGoneView: () => undefined, onToggleViewed: () => undefined, onToggleFold: () => undefined, initialTop });
const renderList = (initialTop = 0) => renderToString(createElement(AllChangesList, listProps(initialTop)));
const sectionProps = (e: Entry, i: number, ready = readyStore()) => ({ anchor: `ac-1-${i}`, e, name: e.path, root: "C:/r", base: null, draw: { split: false, wrap: false, spaces: false }, cache: new Map(), ready, meter: { watch: () => () => undefined }, loaded: new Set<string>(), onFocusView: () => undefined, onGoneView: () => undefined, viewedStamp: undefined, onToggleViewed: () => undefined, folded: false, onToggleFold: () => undefined });

describe("row 837: the section window", () => {
  it("mounts at most ~50 of 2,500 sections on the first paint", () => {
    const html = renderList();
    const n = sectionsIn(html);
    console.log(`row 837: first paint mounts ${n} of ${COUNT} sections`);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(50);
    expect(html).toContain('data-key="u|C:/r/dir0/f0000.ts"');
    expect(html).not.toContain("f2000.ts");
  });

  it("slides along a scroll: the next sections mount, the far ones do not, and the count stays bounded", () => {
    let widest = 0;
    let prevStart = -1;
    for (let top = 0; top < layout.total; top += 700) {
      const s = sliceOf(layout, top, FALLBACK_VIEWPORT);
      widest = Math.max(widest, s.end - s.start);
      expect(s.start).toBeGreaterThanOrEqual(prevStart); // scrolling down never mounts earlier sections
      prevStart = s.start;
      // everything the viewport shows is inside what is mounted
      expect(layout.offsets[s.start]).toBeLessThanOrEqual(top);
      expect(layout.offsets[s.end] - SECTION_GAP).toBeGreaterThanOrEqual(Math.min(top + FALLBACK_VIEWPORT, layout.total));
    }
    console.log(`row 837: widest slice over a full scroll: ${widest} sections`);
    expect(widest).toBeLessThanOrEqual(50);
    const html = renderList(ORIGIN + 20_000);
    const mid = indexAt(layout, 20_000);
    expect(html).toContain(`data-key="${entryKey(entries[mid])}"`);
    expect(html).not.toContain(`data-key="${entryKey(entries[0])}"`);
    expect(sectionsIn(html)).toBeLessThanOrEqual(50);
  });

  it("the spacers and the mounted sections add up to the whole scroll height", () => {
    for (const top of [0, 12_345, 99_000, layout.total]) {
      const s = sliceOf(layout, top, FALLBACK_VIEWPORT);
      const block = layout.offsets[s.end] - layout.offsets[s.start] - SECTION_GAP; // the mounted sections and the gaps between them
      const dom = s.top + (s.top > 0 ? SECTION_GAP : 0) + block + (s.bottom > 0 ? SECTION_GAP : 0) + s.bottom;
      expect(Math.round(dom)).toBe(Math.round(layout.total));
    }
  });

  it("jumping to file #2,000 from the tree mounts it (and only its neighbourhood)", () => {
    const target = 2000;
    const html = renderList(ORIGIN + layout.offsets[target]); // the scroll a jump sets
    const n = sectionsIn(html);
    console.log(`row 837: after a jump to #${target} ${n} sections are mounted`);
    expect(html).toContain(`id="ac-1-${target}"`);
    expect(html).toContain(`data-key="${entryKey(entries[target])}"`);
    expect(n).toBeLessThanOrEqual(50);
    expect(html).not.toContain(`id="ac-1-0"`);
  });

  it("keeps the first visible section where it is when a section above it is measured taller", () => {
    const top = layout.offsets[300] + 40; // 40 px into section 300
    const taller = layoutOf(heights.map((h, i) => (i === 295 ? h + 130 : h)));
    expect(anchoredScroll(layout, taller, top)).toBe(top + 130);
    const lower = layoutOf(heights.map((h, i) => (i === 301 ? h + 99 : h))); // below the anchor: nothing moves
    expect(anchoredScroll(layout, lower, top)).toBe(top);
    const own = layoutOf(heights.map((h, i) => (i === 300 ? h + 99 : h))); // the anchor itself grows downward
    expect(anchoredScroll(layout, own, top)).toBe(top);
  });

  it("handles an empty list and a short one", () => {
    expect(sliceOf(layoutOf([]), 0, 900)).toEqual({ start: 0, end: 0, top: 0, bottom: 0 });
    const few = sliceOf(layoutOf([100, 100, 100]), 0, 900);
    expect(few).toEqual({ start: 0, end: 3, top: 0, bottom: 0 });
  });
});

describe("row 837: sections keep their state while out of the window", () => {
  const big: Entry = { path: "C:/r/big.ts", staged: false, code: "M", lines: 5000, binary: false, stamp: "b1" };
  it("a big diff the user asked for does not wait for a second click after it scrolls back", () => {
    const asked = new Set<string>();
    expect(renderToString(createElement(Section, { ...sectionProps(big, 0), loaded: asked }))).toContain("Load diff");
    asked.add(entryKey(big));
    expect(renderToString(createElement(Section, { ...sectionProps(big, 0), loaded: asked }))).not.toContain("Load diff");
  });
  it("a viewed file stays viewed while its section is unmounted and mounted again", () => {
    const e = entries[7];
    const ready = readyStore();
    const html = (stamp?: string) => renderToString(createElement(Section, { ...sectionProps(e, 7, ready), viewedStamp: stamp }));
    expect(html(e.stamp)).not.toMatch(/checked=""/); // not drawn yet: cannot be viewed
    ready.set(entryKey(e), e.stamp);
    expect(html(e.stamp)).toMatch(/checked=""/);
    expect(html("older-stamp")).not.toMatch(/checked=""/);
  });
  it("binary-sized sections still keep the slice small", () => {
    const small = layoutOf(Array.from({ length: COUNT }, () => SECTION_CHROME + 48));
    let widest = 0;
    for (let top = 0; top < small.total; top += 300) widest = Math.max(widest, sliceOf(small, top, FALLBACK_VIEWPORT).end - sliceOf(small, top, FALLBACK_VIEWPORT).start);
    expect(widest).toBeLessThanOrEqual(50);
  });
});

describe("row 837: a section finishing does not re-render the list", () => {
  it("notifies only the subscribers of that key, plus the total", () => {
    const store = readyStore();
    const calls = { a: 0, b: 0, all: 0 };
    store.subscribe("a", () => calls.a++);
    store.subscribe("b", () => calls.b++);
    store.subscribeAll(() => calls.all++);
    store.set("a", "s1");
    store.set("a", "s1"); // same stamp: nothing
    expect(calls).toEqual({ a: 1, b: 0, all: 1 });
    expect(store.get("a")).toBe("s1");
    store.set("a", null);
    expect(store.get("a")).toBeUndefined();
    expect(calls).toEqual({ a: 2, b: 0, all: 2 });
  });
  it("lets go of a subscriber", () => {
    const store = readyStore();
    let n = 0;
    const off = store.subscribe("a", () => n++);
    off();
    store.set("a", "x");
    expect(n).toBe(0);
  });
});

describe("row 837: the file tree is windowed", () => {
  it("lists a folder line when the folder changes, and filters by path", () => {
    const rows = treeRows(entries.slice(0, 120), "C:/r", "", entryKey);
    expect(rows.filter((r) => r.kind === "file")).toHaveLength(120);
    expect(rows[0]).toMatchObject({ kind: "dir", dir: "dir0" });
    expect(treeRows(entries, "C:/r", "f2000", entryKey).filter((r) => r.kind === "file")).toHaveLength(1);
  });
  it("draws only the rows in view of 2,500 files", () => {
    const rows = treeRows(entries, "C:/r", "", entryKey);
    const w = windowRange(rows.length, 30_000, 480, TREE_ROW, 8);
    expect(rows.length).toBeGreaterThan(COUNT);
    expect(w.end - w.start).toBeLessThanOrEqual(40);
    expect(w.padTop + (w.end - w.start) * TREE_ROW + w.padBottom).toBe(rows.length * TREE_ROW);
  });
});

describe("row 837: first-paint cost at 2,500 changed files", () => {
  it("is a fraction of mounting every section", () => {
    const timeIt = (run: () => string, times = 3) => {
      run();
      const ms: number[] = [];
      for (let k = 0; k < times; k++) {
        const t0 = performance.now();
        run();
        ms.push(performance.now() - t0);
      }
      return ms.sort((a, b) => a - b)[Math.floor(times / 2)];
    };
    // before: every section mounted, as the list did
    const everySection = () => renderToString(createElement("div", null, entries.map((e, i) => createElement(Section, { key: entryKey(e), ...sectionProps(e, i) }))));
    const before = timeIt(everySection);
    const after = timeIt(() => renderList());
    console.log(`row 837: render of ${COUNT} changed files, median of 3: before ${before.toFixed(1)} ms (all mounted), after ${after.toFixed(1)} ms (windowed)`);
    expect(sectionsIn(everySection())).toBe(COUNT);
    expect(after).toBeLessThan(before / 5);
  }, 60_000);
});
