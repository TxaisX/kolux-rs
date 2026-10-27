// LIVE proof, PROJ-070 box 2 (spec/01): delete the active row while the list is scrolled -> the list does not jump.
// 40 worktrees (branches w01..w40) make the sidebar list scroll; w38 is selected with the list scrolled just short of the bottom; Mod+Shift+Backspace + Remove deletes it.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, git, LIVE_BASE, workspaceRows } from "./live-proj-common.mjs";

const DIR = join(LIVE_BASE, "work", "PROJ-070-wt");
const N = 40;
const name = (i) => `w${String(i).padStart(2, "0")}`;
const prepare = async (repo) => {
  rmSync(DIR, { recursive: true, force: true });
  for (let i = 1; i <= N; i++) await git(repo, ["worktree", "add", "-q", "-b", name(i), join(DIR, name(i))]);
};
const FIND = `(() => { const r = document.querySelector(".sidebar .sess"); for (let e = r; e; e = e.parentElement) { const s = getComputedStyle(e); if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 10) return e; } return null; })()`;
const scroll = (app) => app.evalJs(`(() => { const e = ${FIND}; return e ? { top: e.scrollTop, max: e.scrollHeight - e.clientHeight, client: e.clientHeight, cls: e.className } : null; })()`);
const rowTop = (app, label) => app.evalJs(`(() => { const r = document.querySelector('[data-worktree=${JSON.stringify(label)}] .sess'); const e = ${FIND}; if (!r || !e) return null; return Math.round(r.getBoundingClientRect().top - e.getBoundingClientRect().top); })()`);

export async function run070(ctx, { check, log }) {
  const { app } = ctx;
  const rows = await poll(async () => {
    const r = await workspaceRows(app);
    return r.length >= N ? r : null;
  }, 60000, 800);
  log(`rows listed: ${rows ? rows.length : 0}`);
  check(`the sidebar lists the ${N} workspaces`, !!rows, "");
  if (!rows) return;
  const s0 = await scroll(app);
  log(`scroll box: ${JSON.stringify(s0)}`);
  check("the sidebar list scrolls (content taller than the box)", !!s0 && s0.max > 200, JSON.stringify(s0));
  if (!s0 || s0.max <= 200) return;
  const target = name(38);
  await app.evalJs(`document.querySelector('[data-worktree="${target}"] .sess').scrollIntoView({ block: "center" })`);
  await app.click(`[data-worktree="${target}"] .sess`);
  await poll(async () => ((await workspaceRows(app)).find((r) => r.label === target)?.sel ? true : null), 15000, 300);
  await sleep(4000);
  // Scroll the list to just short of the bottom so the active row is on screen and a removed row leaves room.
  await app.evalJs(`(() => { const e = ${FIND}; e.scrollTop = e.scrollHeight - e.clientHeight - 120; })()`);
  await sleep(1000);
  const before = await scroll(app), topBefore = await rowTop(app, name(36));
  log(`before the delete: ${JSON.stringify(before)}; ${name(36)} sits ${topBefore} px below the list top; ${target} selected`);
  check("the active row is on screen with the list scrolled partway", (await rowTop(app, target)) !== null && before.top > 0 && before.top < before.max, JSON.stringify(before));
  await app.focusPane("section.pane[data-agent]", 0, ".xterm-helper-textarea").catch(() => {});
  await app.rawKey({ key: "Backspace", code: "Backspace", vk: 8, mods: 2 | 8 });
  const ask = await poll(async () => ((await app.exists(".sidebar .btn.danger")) ? true : null), 10000, 300);
  check("Mod+Shift+Backspace asks to remove the active workspace", !!ask, "");
  if (!ask) return;
  const mid = await scroll(app);
  log(`while the question is open: ${JSON.stringify(mid)}`);
  await app.clickWhere(".sidebar .btn.danger", "/^\\s*Remove/");
  const gone = await poll(async () => ((await workspaceRows(app)).some((r) => r.label === target) ? null : true), 40000, 400);
  await sleep(3000);
  const after = await scroll(app), topAfter = await rowTop(app, name(36)), sel = (await workspaceRows(app)).filter((r) => r.sel).map((r) => r.label);
  log(`after the delete (row gone=${!!gone}): ${JSON.stringify(after)}; ${name(36)} sits ${topAfter} px below the list top; selected now ${JSON.stringify(sel)}`);
  check("the row is gone", !!gone, "");
  check("the list did not jump (scrollTop unchanged within 1 px, a neighbour row stays where it was)", !!after && Math.abs(after.top - before.top) <= 1 && topAfter !== null && Math.abs(topAfter - topBefore) <= 1, `${before.top} -> ${after?.top}; row ${topBefore} -> ${topAfter}`);
  log(`screenshot: ${await ctx.shot("PROJ-070")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("PROJ-070", { report: rep, prepare });
    await sleep(3000);
    await run070(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "PROJ-070", ev, ok) : 1);
}
