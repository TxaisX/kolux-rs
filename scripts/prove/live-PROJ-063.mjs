// LIVE proof, PROJ-063 box 2 (spec/01): switch branch in a workspace's terminal -> the row shows the new branch (the 5 s poll refreshes it).
// W is a worktree made outside Kolux (no name), so its row is labelled by its branch; N is made through the composer (it has a name), read for the record.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { showElsewhere, reporter, startPlain, finish, sleep, poll, checker, git, LIVE_BASE, fillComposer, submitComposer, workspaceRows } from "./live-proj-common.mjs";

const W_DIR = join(LIVE_BASE, "work", "PROJ-063-W");
const prepare = async (repo) => {
  rmSync(W_DIR, { recursive: true, force: true });
  await git(repo, ["worktree", "add", "-q", "-b", "W", W_DIR]);
};
const rowFacts = (app, label) =>
  app.evalJs(`(() => { const r = document.querySelector('[data-worktree=${JSON.stringify(label)}]'); if (!r) return null; const n = r.querySelector(".name"); return { text: r.innerText.replace(/\\s+/g, " ").trim().slice(0, 120), title: (n?.title ?? "").slice(0, 300), path: r.getAttribute("data-path") }; })()`);

export async function run063(ctx, { check, log }) {
  const { app } = ctx;
  const vis = await app.evalJs(`document.visibilityState`);
  log(`document.visibilityState: ${vis}`);
  const w = await poll(async () => (await workspaceRows(app)).find((r) => r.label === "W") ?? null, 20000, 500);
  check("workspace W (branch W) is listed", !!w, JSON.stringify(w));
  if (!w) return;
  await app.click('[data-worktree="W"] .sess');
  await poll(async () => ((await workspaceRows(app)).find((r) => r.label === "W")?.sel ? true : null), 10000, 300);
  await sleep(4000);
  const t0 = Date.now();
  await ctx.typeInto(0, "git switch -c x063");
  const git1 = await poll(async () => ((await git(w.path, ["branch", "--show-current"])).trim() === "x063" ? true : null), 15000, 400);
  check("the switch happened in W's own terminal (git says the folder is on x063)", !!git1, "");
  const row = await poll(async () => ((await rowFacts(app, "x063")) ? await rowFacts(app, "x063") : null), 45000, 500);
  const waited = Date.now() - t0;
  if (!row) {
    const pj = (await app.invoke("project_list")).find((p) => p.name === "PROJ-063");
    const sc = await app.invoke("workspace_scan", { projectId: pj.id });
    log(`backend view after ${waited} ms: ${JSON.stringify(sc.list.map((x) => ({ path: x.path, branch: x.branch, name: x.name })))}`);
    log(`rows now: ${JSON.stringify(await workspaceRows(app))}; visibility ${await app.evalJs("document.visibilityState")}`);
  }
  const old = await rowFacts(app, "W");
  log(`row for the new branch after ${waited} ms: ${JSON.stringify(row)}; row still labelled W: ${JSON.stringify(old)}`);
  check("the row shows the new branch (x063) within the poll window", !!row && row.path === w.path, JSON.stringify(row));
  check("the old branch name is gone from the row", old === null, JSON.stringify(old));
  log(`screenshot: ${await ctx.shot("PROJ-063")}`);
  // Named workspace made through the composer, for the record.
  await fillComposer(app, { name: "named-063" });
  await submitComposer(app);
  const n = await poll(async () => (await workspaceRows(app)).find((r) => r.label === "named-063") ?? null, 40000, 500);
  if (n) {
    await sleep(5000);
    const before = await rowFacts(app, "named-063");
    await ctx.typeInto(0, "git switch -c y063");
    await poll(async () => ((await git(n.path, ["branch", "--show-current"])).trim() === "y063" ? true : null), 15000, 400);
    await sleep(8000);
    const after = await rowFacts(app, "named-063");
    log(`named workspace row before: ${JSON.stringify(before)}; after the switch to y063: ${JSON.stringify(after)}`);
    log(`named row mentions y063 in its text or hover: ${/y063/.test(JSON.stringify(after))}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("PROJ-063", { report: rep, prepare });
    await showElsewhere(ctx.app);
    await sleep(3000);
    await run063(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "PROJ-063", ev, ok) : 1);
}
