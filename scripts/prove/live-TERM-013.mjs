// LIVE proof, TERM-013 box 1 + 2 (spec/03): Expand then Restore returns every pane to its prior size, and the
// expanded pane's scrollback is unchanged after Restore. Hidden app, three shell panes, over CDP.
import { reporter, startPlain, finish, sleep, waitFor, TERM } from "./live-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
let ctx;
let ok = false;
const asserts = [];
const check = (name, pass, detail) => {
  asserts.push(pass);
  log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
try {
  ctx = await startPlain("TERM-013", { report: rep });
  const { app } = ctx;
  // Three shell panes: split right from the first one twice.
  for (const want of [2, 3]) {
    await app.focusPane(TERM, 0, ".xterm-helper-textarea");
    await app.click('.pane.focused button[title^="Split right"]');
    await waitFor(`${want} panes`, async () => (await app.shown(TERM)) === want, 30000);
  }
  await waitFor("pane 2's input field", () => app.exists(`${TERM} .xterm-helper-textarea`), 20000);
  await sleep(3000); // shells start
  // Pane 2 prints 200 numbered lines (scrollback).
  await ctx.typeInto(1, '1..200 | % { "line $_" }');
  await waitFor("200 lines in pane 2", async () => /line 200\b/.test((await ctx.text(1)) ?? ""), 30000, 500);
  await sleep(1500);

  const rectsBefore = await ctx.rects();
  const bufBefore = await ctx.lines(1);
  const numberedBefore = bufBefore.lines.filter((l) => /^line \d+$/.test(l.trim()));
  log(`before: ${rectsBefore.length} panes; rects ${JSON.stringify(rectsBefore.map((r) => [r.x, r.y, r.w, r.h].map((n) => Math.round(n * 10) / 10)))}`);
  log(`before: pane 2 buffer length ${bufBefore.lines.length} (rows ${bufBefore.rows}, cols ${bufBefore.cols}), numbered lines ${numberedBefore.length}`);
  check("three panes shown", rectsBefore.length === 3, String(rectsBefore.length));

  // Expand pane 2 (second shown pane's header button).
  const press = (title) => app.evalJs(`(() => { const p = [...document.querySelectorAll(${JSON.stringify(TERM)})].filter(e => e.offsetParent !== null)[1]; const b = p && p.querySelector('button.ib[title^="${title}"]'); if (!b) return "missing"; b.click(); return "clicked"; })()`);
  const pressExpanded = (title) => app.evalJs(`(() => { const p = [...document.querySelectorAll(${JSON.stringify(TERM)})].find(e => e.offsetParent !== null && e.querySelector('button.ib[title^="${title}"]')); const b = p && p.querySelector('button.ib[title^="${title}"]'); if (!b) return "missing"; b.click(); return "clicked"; })()`);
  check("Expand clicked", (await press("Expand")) === "clicked", "button.ib[title^=Expand] on pane 2");
  await waitFor("only one pane shown", async () => (await app.shown(TERM)) === 1, 10000, 250);
  await sleep(1500);
  const expandedRects = await ctx.rects();
  const bufExp = await ctx.lines(0);
  log(`expanded: ${expandedRects.length} pane shown; rect ${JSON.stringify(expandedRects.map((r) => [r.x, r.y, r.w, r.h].map(Math.round)))}; buffer length ${bufExp.lines.length} (rows ${bufExp.rows}, cols ${bufExp.cols})`);
  check("expanded pane fills more than its slot", expandedRects.length === 1 && expandedRects[0].w > rectsBefore[1].w + 20, `${Math.round(expandedRects[0]?.w)} px wide vs ${Math.round(rectsBefore[1].w)}`);
  await ctx.shot("TERM-013-expanded");

  check("Restore clicked", (await pressExpanded("Restore")) === "clicked", "button.ib[title^=Restore]");
  await waitFor("three panes shown again", async () => (await app.shown(TERM)) === 3, 10000, 250);
  await sleep(2500);
  const rectsAfter = await ctx.rects();
  const bufAfter = await ctx.lines(1);
  const numberedAfter = bufAfter.lines.filter((l) => /^line \d+$/.test(l.trim()));
  log(`after: rects ${JSON.stringify(rectsAfter.map((r) => [r.x, r.y, r.w, r.h].map((n) => Math.round(n * 10) / 10)))}`);
  log(`after: pane 2 buffer length ${bufAfter.lines.length} (rows ${bufAfter.rows}, cols ${bufAfter.cols}), numbered lines ${numberedAfter.length}`);
  const maxDiff = rectsAfter.length === rectsBefore.length ? Math.max(...rectsBefore.flatMap((a, i) => ["x", "y", "w", "h"].map((k) => Math.abs(a[k] - rectsAfter[i][k])))) : Infinity;
  check("box 1: every pane rect equal within 1 px after Restore", maxDiff <= 1, `max difference ${maxDiff.toFixed ? maxDiff.toFixed(2) : maxDiff} px over ${rectsAfter.length} panes`);
  const same = numberedBefore.length === numberedAfter.length && numberedBefore.every((l, i) => l.trim() === numberedAfter[i].trim());
  const nonBlank = (b) => b.lines.map((l) => l.trimEnd()).filter(Boolean);
  const first20 = JSON.stringify(nonBlank(bufBefore).slice(0, 20)) === JSON.stringify(nonBlank(bufAfter).slice(0, 20));
  const last20 = JSON.stringify(nonBlank(bufBefore).slice(-20)) === JSON.stringify(nonBlank(bufAfter).slice(-20));
  check("box 2: the 200 numbered scrollback lines are identical after Restore", same && numberedAfter.length === 200, `${numberedBefore.length} -> ${numberedAfter.length} lines; first line ${numberedAfter[0]?.trim()}, last ${numberedAfter.at(-1)?.trim()}`);
  check("box 2: first 20 and last 20 non-blank lines identical", first20 && last20, `first20 ${first20}, last20 ${last20}; buffer length ${bufBefore.lines.length} -> ${bufAfter.lines.length}`);
  log(`screenshot: ${await ctx.shot("TERM-013-restored")}`);
  ok = asserts.every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "TERM-013", ev, ok) : 1);
