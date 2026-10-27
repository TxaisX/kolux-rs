// LIVE proof, PROJ-066 box 1 (spec/01): switch from workspace A to B and back -> A's terminals and tabs are as they were.
// A = the main checkout (two terminals: the first shell plus a Blank terminal tab, with a marker typed in the active one); B = a prepared second worktree.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, git, LIVE_BASE, panes, shownPanes, tabLabels, workspaceRows } from "./live-proj-common.mjs";
import { PLUS } from "./live-SESS-004.mjs";

const B_DIR = join(LIVE_BASE, "work", "PROJ-066-B");
const prepare = async (repo) => {
  rmSync(B_DIR, { recursive: true, force: true });
  await git(repo, ["worktree", "add", "-q", "-b", "B", B_DIR]);
};
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

async function addBlank(app) {
  await app.evalJs(`document.querySelector(${JSON.stringify(PLUS)}).click()`);
  await poll(() => app.exists('[role=menu][aria-label="New session"]'), 8000, 300);
  return app.evalJs(`(() => { const b = [...document.querySelectorAll('[role=menu][aria-label="New session"] [role=menuitem]')].find(b => /^Blank terminal/.test(b.textContent.trim())); if (!b) return false; b.click(); return true; })()`);
}

export async function run066(ctx, { check, log }) {
  const { app } = ctx;
  const rows = await poll(async () => {
    const r = await workspaceRows(app);
    return r.find((x) => x.label === "B") ? r : null;
  }, 20000, 500);
  log(`rows: ${JSON.stringify(rows)}`);
  check("workspace B is listed beside the main checkout", !!rows, "");
  if (!rows) return;
  const clicked = await addBlank(app);
  const two = await poll(async () => ((await panes(app)).length >= 2 ? true : null), 20000, 400);
  await sleep(3000);
  check("A now has two terminals (first shell + Blank terminal)", clicked && !!two, `clicked=${clicked}`);
  await ctx.typeInto(0, "echo marker-A-066");
  const markA = await poll(async () => (((await ctx.text(0)) ?? "").includes("marker-A-066") ? true : null), 10000, 400);
  check("a marker is typed in A's front terminal", !!markA, "");
  const aPanes = await panes(app), aTabs = await tabLabels(app), aShown = await shownPanes(app), aPids = await ctx.shellPids();
  log(`A before: panes ${JSON.stringify(aPanes)}; tabs ${JSON.stringify(aTabs)}; shell pids ${JSON.stringify(aPids)}`);
  log(`screenshot: ${await ctx.shot("PROJ-066-A")}`);
  await app.click('[data-worktree="B"] .sess');
  const inB = await poll(async () => {
    const r = await workspaceRows(app);
    const s = await shownPanes(app);
    return r.find((x) => x.label === "B")?.sel && s.length >= 1 && !s.some((p) => aShown.some((q) => q.label === p.label)) ? s : null;
  }, 30000, 500);
  log(`in B: shown ${JSON.stringify(inB)}`);
  check("switching to B shows B's own terminal, not A's", !!inB, JSON.stringify(inB));
  await sleep(2500);
  await ctx.typeInto(0, "echo marker-B-066");
  await poll(async () => (((await ctx.text(0)) ?? "").includes("marker-B-066") ? true : null), 10000, 400);
  log(`screenshot: ${await ctx.shot("PROJ-066-B")}`);
  await app.click(".sidebar button.branch");
  const back = await poll(async () => {
    const s = await shownPanes(app);
    return same(s.map((p) => p.label), aShown.map((p) => p.label)) ? s : null;
  }, 30000, 500);
  await sleep(1500);
  const bPanes = await panes(app), bTabs = await tabLabels(app), bPids = await ctx.shellPids(), text = (await ctx.text(0)) ?? "";
  const aLabels = new Set(aPanes.map((p) => p.label));
  log(`A after: panes ${JSON.stringify(bPanes.filter((p) => aLabels.has(p.label)))}; tabs ${JSON.stringify(bTabs)}; shell pids ${JSON.stringify(bPids)}; front text has marker-A ${text.includes("marker-A-066")}, marker-B ${text.includes("marker-B-066")}`);
  check("back in A the same terminals are in front", !!back, JSON.stringify(back));
  check("A's panes (agent, label, which one is shown) are as they were", same(bPanes.filter((p) => aLabels.has(p.label)), aPanes), "");
  check("A's tabs are as they were", same(bTabs, aTabs), `${JSON.stringify(aTabs)} vs ${JSON.stringify(bTabs)}`);
  check("the same shell processes are still running (A's terminals were not restarted)", aPids.every((p) => bPids.includes(p)), `${JSON.stringify(aPids)} vs ${JSON.stringify(bPids)}`);
  check("A's front terminal still holds its marker and none of B's", text.includes("marker-A-066") && !text.includes("marker-B-066"), "");
  log(`screenshot: ${await ctx.shot("PROJ-066")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("PROJ-066", { report: rep, prepare });
    await sleep(3000);
    await run066(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "PROJ-066", ev, ok) : 1);
}
