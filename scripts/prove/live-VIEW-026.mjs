// LIVE proof, VIEW-026 box 1 + 2 (spec/05): on the Board, expand a card, type a command in it, collapse -> the grid pane
// shows the same output in the same position; closing the card puts the terminal back in its grid slot, process alive.
// Hidden app, one shell pane, over CDP.
import { reporter, startPlain, finish, sleep, waitFor, TERM, snap, pickScreen, checker } from "./live-views-dom.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const { check, allPassed } = checker(log);
let ctx;
let ok = false;
const stamp = Date.now().toString(36).slice(-4);
const M = `C${stamp}-END`;
const ALIVE = `A${stamp}-LIVE`;
try {
  ctx = await startPlain("VIEW-026", { report: rep });
  const { app } = ctx;
  await sleep(3000);
  // Tag the pane element so identity (never moved or rebuilt) can be checked at the end.
  await app.evalJs(`(() => { const p = [...document.querySelectorAll(${JSON.stringify(TERM)})].find((e) => e.offsetParent !== null); p.__proveTag = "v26"; })()`);
  const pidsBefore = await ctx.shellPids();
  await pickScreen(app, "Board");
  await sleep(1500);
  const cardInfo = () =>
    app.evalJs(`(() => { const s = document.querySelector("section.pane.card"); if (!s) return null; const b = s.getBoundingClientRect(); const host = [...s.querySelectorAll("div")].find((d) => d.__koluxTerm); const hb = host ? host.getBoundingClientRect() : null; const btn = [...s.querySelectorAll("button")].find((x) => /^(Expand|Collapse)/.test(x.title)); return { tag: s.__proveTag ?? null, expanded: s.classList.contains("expanded"), card: { w: Math.round(b.width), h: Math.round(b.height) }, termVisible: !!host && host.offsetParent !== null && hb.width > 20 && hb.height > 20, term: hb ? { w: Math.round(hb.width), h: Math.round(hb.height) } : null, btnTitle: btn ? btn.title : null, parentClass: s.parentElement.className }; })()`);
  const c0 = await cardInfo();
  log(`Board card, collapsed: ${JSON.stringify(c0)}`);
  check("setup: the Board shows the pane as a collapsed card (terminal not visible)", !!c0 && !c0.expanded && !c0.termVisible && /^Expand/.test(c0.btnTitle ?? ""), JSON.stringify(c0));
  log(`screenshot: ${await ctx.shot("VIEW-026-board-collapsed")}`);

  // Expand it and type.
  await app.clickWhere("section.pane.card button", "/^Expand: show this session/");
  await sleep(1500);
  const c1 = await cardInfo();
  log(`Board card, expanded: ${JSON.stringify(c1)}`);
  check("expanding the card shows the live terminal inside it", !!c1 && c1.expanded && c1.termVisible, JSON.stringify(c1));
  await app.focusPane("section.pane.card", 0, ".xterm-helper-textarea");
  await sleep(400);
  await app.cdp("insert", `Write-Output '${M}'`, "enter");
  const rowOf = async () => {
    const r = await ctx.lines(0);
    if (!r) return null;
    return r.lines.map((l) => l.trim()).lastIndexOf(M);
  };
  await waitFor("the marker in the expanded card", async () => ((await ctx.text(0)) ?? "").split("\n").some((l) => l.trim() === M), 30000, 500);
  const before = await ctx.lines(0);
  const rowBefore = before.lines.map((l) => l.trim()).lastIndexOf(M);
  const fullBefore = before.lines.map((l) => l.trimEnd()).join("\n");
  log(`marker typed in the card: buffer row ${rowBefore} of ${before.lines.length} rows`);
  log(`screenshot: ${await ctx.shot("VIEW-026-board-expanded")}`);

  // Collapse (box 1: the grid pane shows the same output in the same position).
  await app.clickWhere("section.pane.card button", "/^Collapse: the terminal goes back/");
  await sleep(1500);
  const c2 = await cardInfo();
  log(`Board card, collapsed again: ${JSON.stringify(c2)}`);
  check("collapsing hides the terminal again", !!c2 && !c2.expanded && !c2.termVisible, JSON.stringify(c2));
  await pickScreen(app, "Terminals");
  await sleep(2500);
  const s = await snap(app);
  const after = await ctx.lines(0);
  const rowAfter = after ? after.lines.map((l) => l.trim()).lastIndexOf(M) : -1;
  const fullAfter = after ? after.lines.map((l) => l.trimEnd()).join("\n") : "";
  log(`grid pane: ${JSON.stringify(s)}; marker at buffer row ${rowAfter} of ${after?.lines.length}`);
  check("box 1: the grid pane shows the same output (marker present) in the same position (same buffer row)", rowAfter >= 0 && rowAfter === rowBefore, `row ${rowBefore} -> ${rowAfter}`);
  check("box 1: the whole buffer is the same text", fullBefore === fullAfter, `${fullBefore.length} -> ${fullAfter.length} chars`);
  log(`screenshot: ${await ctx.shot("VIEW-026-grid")}`);

  // Box 2: close the expanded card -> terminal back in its grid slot, process still running.
  await pickScreen(app, "Board");
  await sleep(1200);
  await app.clickWhere("section.pane.card button", "/^Expand: show this session/");
  await sleep(1200);
  await app.clickWhere("section.pane.card button", "/^Collapse: the terminal goes back/");
  await sleep(1200);
  await pickScreen(app, "Terminals");
  await sleep(2500);
  const slot = await app.evalJs(`(() => { const p = [...document.querySelectorAll(${JSON.stringify(TERM)})].find((e) => e.offsetParent !== null); if (!p) return null; const cell = p.closest(".cell"); const b = p.getBoundingClientRect(); return { tag: p.__proveTag ?? null, inGrid: !!p.closest(".grid:not(.agents)"), cell: !!cell, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })()`);
  log(`terminal back in the grid slot: ${JSON.stringify(slot)}`);
  check("box 2: the same pane element sits in the grid slot with the full area", !!slot && slot.tag === "v26" && slot.inGrid && slot.w > 300 && slot.h > 200, JSON.stringify(slot));
  await app.focusPane(TERM, 0, ".xterm-helper-textarea");
  await app.cdp("insert", `Write-Output '${ALIVE}'`, "enter");
  const alive = await waitFor("the post-close command to run", async () => ((await ctx.text(0)) ?? "").split("\n").some((l) => l.trim() === ALIVE), 20000, 500).then(() => true, () => false);
  const pidsAfter = await ctx.shellPids();
  check("box 2: the process is still running (answers a new command; same shell pids)", alive && pidsBefore.join() === pidsAfter.join(), `alive ${alive}; ${pidsBefore.join()} -> ${pidsAfter.join()}`);
  ok = allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "VIEW-026", ev, ok) : 1);
