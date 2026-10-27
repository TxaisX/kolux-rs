// LIVE proof, VIEW-005 box 1 (spec/05): open the Tasks page, quit (the window's own close), relaunch on the same profile ->
// Tasks is shown. Hidden app, over CDP. (Box 2 is DRIFT for Txais and is not touched here.)
import { readFileSync } from "node:fs";
import { reporter, startPlain, finish, sleep, waitFor, checker } from "./live-views-dom.mjs";
import { dismissFirstRun } from "./live-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const { check, allPassed } = checker(log);
let ctx;
let ok = false;
const tasksUp = (app) =>
  app.evalJs(`(() => { const row = [...document.querySelectorAll(".sidebar-wrap .row")].find((r) => /Tasks/.test(r.textContent)); const vis = (e) => !!e && e.offsetParent !== null; return { rowCurrent: row ? row.getAttribute("aria-current") : "no row", filters: [...document.querySelectorAll(".tasks-tabs")].filter(vis).length, picker: [...document.querySelectorAll("h1,h2")].some((h) => vis(h) && /^Tasks$/.test(h.textContent.trim())) }; })()`);
try {
  ctx = await startPlain("VIEW-005", { report: rep });
  const { app } = ctx;
  await sleep(3000);
  const t0 = await tasksUp(app);
  log(`before opening: ${JSON.stringify(t0)}`);
  check("setup: Tasks is not the page in front before the click", t0.rowCurrent !== "page" && t0.filters === 0, JSON.stringify(t0));
  await app.clickWhere(".sidebar-wrap .row", "/Tasks/");
  await waitFor("the Tasks page", async () => (await tasksUp(app)).rowCurrent === "page" && (await tasksUp(app)).filters > 0, 15000, 500);
  const t1 = await tasksUp(app);
  log(`Tasks open: ${JSON.stringify(t1)}`);
  log(`screenshot: ${await ctx.shot("VIEW-005-tasks-open")}`);
  await sleep(1500);
  const saved = JSON.parse(readFileSync(`${app.paths.profile}/settings.json`, "utf8"));
  log(`settings.json openPage after one second: ${JSON.stringify(saved.openPage)}`);
  const closed = await app.closeAndCount(app.pid);
  log(`quit: ${closed.how}; survivors ${closed.survivors.length}`);
  await app.relaunch();
  await dismissFirstRun(app, log);
  await waitFor("the sidebar", () => app.exists(".sidebar-wrap .row"), 60000, 500);
  await waitFor("the Tasks page after relaunch", async () => (await tasksUp(app)).rowCurrent === "page", 30000, 500).catch(() => {});
  await sleep(1500);
  const t2 = await tasksUp(app);
  log(`after relaunch: ${JSON.stringify(t2)}`);
  check("relaunch: Tasks is shown (its sidebar row is the current page and its Tasks heading and tab bar are on screen)", t2.rowCurrent === "page" && t2.filters > 0 && t2.picker, JSON.stringify(t2));
  log(`screenshot: ${await ctx.shot("VIEW-005-tasks-after-relaunch")}`);
  ok = allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "VIEW-005", ev, ok) : 1);
