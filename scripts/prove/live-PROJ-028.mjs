// LIVE proof, PROJ-028 box 1 (spec/01): the project's saved base branch (origin/dev) is deleted on the remote, then a workspace is created ->
// it starts from the default branch (main) and a fallback notice appears. The remote is a scratch bare repo next to the work repo.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, git, LIVE_BASE, addBareOrigin, fillComposer, submitComposer, workspaceRows, sidebarNote, norm } from "./live-proj-common.mjs";

const ORIGIN = join(LIVE_BASE, "work", "PROJ-028-origin.git");

export async function run028(ctx, { check, log }) {
  const { app, repo } = ctx;
  await app.click('.proj button.ib[title^="Project settings"]');
  await app.waitFor("the base ref field", () => app.exists('input[aria-label="project base ref"]'), 8000);
  await app.focusField('input[aria-label="project base ref"]');
  await app.cdp("insert", "origin/dev", "enter");
  const saved = await poll(async () => {
    const n = await sidebarNote(app);
    return n && /starting from origin\/dev/.test(n.text) ? n : null;
  }, 10000, 400);
  log(`saved-base note: ${JSON.stringify(saved)}`);
  check("the project's base is saved as origin/dev", !!saved, JSON.stringify(saved));
  // Delete the saved base branch on the remote.
  await git(ORIGIN, ["branch", "-D", "dev"]);
  const remoteBranches = await git(ORIGIN, ["branch", "--list"]);
  log(`remote branches now: ${JSON.stringify(remoteBranches.split(/\r?\n/).map((s) => s.trim()))}`);
  check("dev is gone on the remote", !/\bdev\b/.test(remoteBranches), remoteBranches.replace(/\s+/g, " "));
  const mainSha = (await git(repo, ["rev-parse", "main"])).trim();
  await fillComposer(app, { name: "fallback-test" });
  await submitComposer(app);
  const row = await poll(async () => (await workspaceRows(app)).find((r) => r.label === "fallback-test") ?? null, 40000, 500);
  check("the workspace was created", !!row, JSON.stringify(row));
  const note = await poll(async () => {
    const n = await sidebarNote(app);
    return n && /fallback-test/.test(n.text) ? n : null;
  }, 15000, 400);
  log(`sidebar note after create: ${JSON.stringify(note)}`);
  check("a fallback notice appears naming the missing saved base and the default it used instead", !!note && /warn/.test(note.cls) && /saved base origin\/dev no longer exists/.test(note.text) && /started from main instead/.test(note.text), JSON.stringify(note));
  if (row) {
    const head = (await git(row.path, ["rev-parse", "HEAD"])).trim();
    check("the workspace starts from the default branch (its HEAD is main's commit)", head === mainSha && existsSync(row.path), `HEAD ${head.slice(0, 10)} vs main ${mainSha.slice(0, 10)}`);
    void norm;
  }
  log(`screenshot: ${await ctx.shot("PROJ-028")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("PROJ-028", { report: rep, prepare: (repo) => addBareOrigin(repo, ORIGIN, ["dev"]) });
    await sleep(3000);
    await run028(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "PROJ-028", ev, ok) : 1);
}
