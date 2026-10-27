// LIVE proof, VIEW-002 box 2 + VIEW-004 box 2 (spec/05), Classic look in one hidden launch:
//  VIEW-002 b2: Classic look, press the cycle chord (Ctrl+Alt+V) -> nothing changes.
//  VIEW-004 b2: Classic look: the worktree sidebar is visible on every screen (the one screen, and a full page opened over it).
import { reporter, startPlain, finish, sleep, waitFor, TERM, snap, checker } from "./live-views-dom.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const { check, allPassed } = checker(log);
let ctx;
let ok = false;
try {
  ctx = await startPlain("VIEW-002", { report: rep, settings: { uiLook: "classic", lastScreen: "board", firstScreen: "agents" } });
  const { app } = ctx;
  await sleep(3000);
  const a = await snap(app);
  log(`classic start: ${JSON.stringify(a)}`);
  check("classic look: no top bar and no screen switch", !a.topbar && a.labels.length === 0, JSON.stringify({ topbar: a.topbar, labels: a.labels }));
  check("classic look with Board saved as the last screen still opens on the terminal screen, sidebar visible", a.worktreeSidebar && a.grid, JSON.stringify({ worktreeSidebar: a.worktreeSidebar, grid: a.grid }));
  const htmlBefore = await app.evalJs(`document.querySelector("#root").innerHTML.length`);
  const rectsBefore = JSON.stringify(await ctx.rects());
  await app.focusPane(TERM, 0, ".xterm-helper-textarea");
  for (let i = 0; i < 4; i++) {
    await app.cdp("key", "v", "3"); // Alt=1 + Ctrl=2
    await sleep(700);
  }
  await sleep(1000);
  const b = await snap(app);
  const rectsAfter = JSON.stringify(await ctx.rects());
  log(`after four Ctrl+Alt+V: ${JSON.stringify(b)}`);
  check("VIEW-002 b2: after the chord nothing changed (same screen reading, same pane geometry, sidebar still there)", JSON.stringify(a) === JSON.stringify(b) && rectsBefore === rectsAfter, `snap equal ${JSON.stringify(a) === JSON.stringify(b)}, rects equal ${rectsBefore === rectsAfter}`);
  check("VIEW-002 b2: still no top bar after the chord", !b.topbar && !b.board && !b.agentsGrid && b.grid, JSON.stringify({ topbar: b.topbar, board: b.board, agentsGrid: b.agentsGrid, grid: b.grid }));
  log(`root html length before/after: ${htmlBefore}/${await app.evalJs(`document.querySelector("#root").innerHTML.length`)} (informational: terminal output may move it)`);
  log(`screenshot: ${await ctx.shot("VIEW-002-classic")}`);

  // VIEW-004 b2: every page Classic can reach keeps the sidebar: open each row of the sidebar's own page list.
  const rows = await app.evalJs(`[...document.querySelectorAll(".sidebar-wrap:not(.rail-wrap) .row")].map((r) => r.textContent.trim().slice(0, 30))`);
  log(`sidebar page rows in Classic: ${JSON.stringify(rows)}`);
  check("setup: Classic's sidebar offers page rows to open", rows.length >= 1, JSON.stringify(rows));
  for (let i = 0; i < rows.length; i++) {
    await app.evalJs(`[...document.querySelectorAll(".sidebar-wrap:not(.rail-wrap) .row")][${i}].click()`);
    await sleep(1500);
    const c = await snap(app);
    log(`opened row ${i} "${rows[i]}": ${JSON.stringify(c)}`);
    check(`VIEW-004 b2: with "${rows[i]}" open the worktree sidebar is still visible and no Agents/Board/top bar appeared`, c.worktreeSidebar && !c.board && !c.agentsGrid && !c.topbar && c.labels.length === 0, JSON.stringify({ worktreeSidebar: c.worktreeSidebar, board: c.board, agentsGrid: c.agentsGrid, topbar: c.topbar }));
    if (i === 0) log(`screenshot: ${await ctx.shot("VIEW-004-classic-page")}`);
  }
  ok = allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "VIEW-002", ev, ok) : 1);
