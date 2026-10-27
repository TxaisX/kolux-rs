// LIVE proof, PROJ-020 box 2 (spec/01): start a create, move to another workspace, and the create finishes in the background without taking focus.
// A post-checkout hook (added after the pre-existing second workspace exists) sleeps 4 s inside `git worktree add`, which gives the create a deterministic window.
import { existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { showElsewhere, reporter, startPlain, finish, sleep, poll, checker, git, LIVE_BASE, fillComposer, submitComposer, workspaceRows, sidebarNote, shownPanes } from "./live-proj-common.mjs";

const DONE = join(LIVE_BASE, "work", "PROJ-020b-hook-done.txt");
const OTHER = join(LIVE_BASE, "work", "PROJ-020b-other");

async function prepare(repo) {
  rmSync(DONE, { force: true });
  rmSync(OTHER, { recursive: true, force: true });
  await git(repo, ["worktree", "add", "-q", "-b", "other", OTHER]);
  writeFileSync(join(repo, ".git", "hooks", "post-checkout"), `#!/bin/sh\nsleep 4\necho done > "${DONE.replace(/\\/g, "/")}"\n`);
}

export async function run020b(ctx, { check, log }) {
  const { app, repo } = ctx;
  const before = await poll(async () => {
    const r = await workspaceRows(app);
    return r.find((x) => x.label === "other") ? r : null;
  }, 20000, 500);
  log(`rows before: ${JSON.stringify(before)}`);
  check("the pre-existing second workspace (other) is listed", !!before, "");
  if (!before) return;
  await fillComposer(app, { name: "bg-create" });
  await submitComposer(app);
  const t0 = Date.now();
  await app.click('[data-worktree="other"] .sess');
  const switched = await poll(async () => ((await workspaceRows(app)).find((r) => r.label === "other")?.sel ? true : null), 5000, 200);
  const stillRunning = !existsSync(DONE);
  const mid = await workspaceRows(app);
  log(`${Date.now() - t0} ms after submit: switched to other=${!!switched}; create still running (hook not done)=${stillRunning}; rows ${JSON.stringify(mid)}`);
  check("moved to the other workspace while the create was still running", !!switched && stillRunning, `switched=${!!switched} stillRunning=${stillRunning}`);
  const done = await poll(async () => (existsSync(DONE) ? true : null), 30000, 300);
  const row = await poll(async () => (await workspaceRows(app)).find((r) => r.label === "bg-create") ?? null, 30000, 400);
  await sleep(2500);
  const after = await workspaceRows(app);
  const wt = await git(repo, ["worktree", "list", "--porcelain"]);
  const note = await sidebarNote(app);
  const shown = await shownPanes(app);
  log(`after the hook finished (${!!done}): rows ${JSON.stringify(after)}; note ${JSON.stringify(note)}; shown panes ${JSON.stringify(shown)}`);
  check("the create finished in the background: the bg-create row appears and git lists its worktree", !!done && !!row && wt.includes("bg-create"), JSON.stringify(row));
  const sel = after.filter((r) => r.sel).map((r) => r.label);
  check("focus stayed on the other workspace (only other is selected)", sel.length === 1 && sel[0] === "other", JSON.stringify(sel));
  check("the pane in front is not the new workspace's", shown.length >= 1 && !shown.some((p) => /bg-create/.test(String(p.label))), JSON.stringify(shown));
  log(`screenshot: ${await ctx.shot("PROJ-020b")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("PROJ-020b", { report: rep, prepare });
    await showElsewhere(ctx.app);
    await sleep(3000);
    await run020b(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "PROJ-020b", ev, ok) : 1);
}
