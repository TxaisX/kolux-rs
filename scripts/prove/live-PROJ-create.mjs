// LIVE proof, spec/01: PROJ-020 box 1 (create fix-login: branch and folder exist, its terminal starts in that folder, the main checkout's terminal
// stays apart), PROJ-038 box 1 (Claude with prompt "hello": the first tab runs Claude with that prompt) and PROJ-038 box 2 (no extra empty tab).
// One create (name fix-login, agent Claude, note hello) answers all three. Claude is the stand-in claude.cmd (banner, argv, folder).
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, STANDIN_BODY, STANDIN_BANNER, CLAUDE_PANE, TERM, git, panes, shownPanes, tabLabels, fillComposer, submitComposer, workspaceRows, sidebarNote, norm } from "./live-proj-common.mjs";

export async function runCreate(ctx, { check, log }) {
  const { app, repo } = ctx;
  const mainPrompt = await poll(async () => ((await ctx.text(0, TERM)) ?? "").trim() || null, 15000, 500);
  log(`main checkout terminal before: ${JSON.stringify((mainPrompt ?? "").split("\n").filter(Boolean).slice(-2))}`);
  const rowsBefore = await workspaceRows(app);
  log(`rows before: ${JSON.stringify(rowsBefore)}`);
  await fillComposer(app, { name: "fix-login", agent: "claude", note: "hello" });
  const preview = await app.evalJs(`document.querySelector(".sb-form .preview")?.textContent ?? ""`);
  log(`composer preview: ${JSON.stringify(preview)}`);
  await submitComposer(app);
  const row = await poll(async () => (await workspaceRows(app)).find((r) => r.label === "fix-login") ?? null, 40000, 500);
  const note = await poll(() => sidebarNote(app), 5000, 500);
  log(`sidebar note: ${JSON.stringify(note)}`);
  check("a workspace row named fix-login appears", !!row, JSON.stringify(row));
  if (!row) return;
  const path = row.path;
  const branches = (await git(repo, ["branch", "--list", "--format=%(refname:short)"])).split(/\r?\n/).map((s) => s.trim());
  const wtList = await git(repo, ["worktree", "list", "--porcelain"]);
  const branchName = branches.find((b) => b.endsWith("fix-login")) ?? null;
  log(`branches: ${JSON.stringify(branches)}; worktree path ${path}`);
  check("its branch exists in the repository", !!branchName, `branch ${branchName}`);
  check("its folder exists and git lists it as a worktree of that branch", existsSync(path) && norm(wtList).includes(norm(path)) && wtList.includes(`branch refs/heads/${branchName}`), `${path} exists=${existsSync(path)}`);
  await poll(async () => ((await app.shown(CLAUDE_PANE)) >= 1 ? true : null), 30000, 500);
  const text = await poll(async () => {
    const t = await ctx.text(0, CLAUDE_PANE);
    return t && t.includes("CWD:") ? t : null;
  }, 30000, 500);
  const rowsText = (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  log(`claude pane text: ${JSON.stringify(rowsText.slice(0, 6))}`);
  const cwd = (rowsText.find((l) => l.startsWith("CWD:")) ?? "").slice(4).trim();
  const argv = (rowsText.find((l) => l.startsWith("ARGV:")) ?? "").slice(5).trim();
  check("PROJ-020 b1: the new workspace's terminal started in that folder", !!cwd && norm(cwd) === norm(path), `cwd ${cwd} vs ${path}`);
  check("PROJ-038 b1: the first tab runs Claude (stand-in banner) with the prompt hello", !!text && text.includes(STANDIN_BANNER) && /\bhello\b/.test(argv), `argv ${JSON.stringify(argv)}`);
  const tabs = await tabLabels(app);
  const shown = await shownPanes(app);
  log(`tabs in the new workspace: ${JSON.stringify(tabs)}; shown panes: ${JSON.stringify(shown)}`);
  check("PROJ-038 b2: no additional empty default tab (a lone pane with no tab strip or one tab, and it is Claude)", tabs.length <= 1 && shown.length === 1 && /claude/.test(shown[0].agent), `${tabs.length} tab(s), ${shown.length} pane(s), agents ${JSON.stringify(shown.map((p) => p.agent))}`);
  log(`screenshot: ${await ctx.shot("PROJ-038")}`);
  // Back to the main checkout: its own terminal, apart from the new workspace's.
  await app.click(".sidebar button.branch");
  const mainShown = await poll(async () => ((await app.shown(CLAUDE_PANE)) === 0 && (await app.shown(TERM)) >= 1 ? true : null), 15000, 500);
  const mainText = (await ctx.text(0, TERM)) ?? "";
  const tail = mainText.split("\n").map((l) => l.trim()).filter(Boolean).slice(-3);
  log(`main checkout terminal after switching back: ${JSON.stringify(tail)}`);
  const mainRows = await workspaceRows(app);
  log(`rows: ${JSON.stringify(mainRows)}`);
  check("PROJ-020 b1: back in the main checkout, only its own shell shows (the Claude pane is not in front)", !!mainShown, "");
  check("PROJ-020 b1: the main checkout's terminal is in the main folder, not the new one", norm(mainText).includes(norm(repo)) && !norm(mainText).includes(norm(path)), tail.join(" | ").slice(0, 200));
  log(`screenshot: ${await ctx.shot("PROJ-020")}`);
  await app.click(`[data-worktree="fix-login"] .sess`);
  const back = await poll(async () => ((await app.shown(CLAUDE_PANE)) >= 1 ? await ctx.text(0, CLAUDE_PANE) : null), 15000, 500);
  check("going back to fix-login shows the same Claude terminal (banner still in its buffer)", !!back && back.includes(STANDIN_BANNER), "");
  void panes;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("PROJ-create", { report: rep, standin: STANDIN_BODY });
    await sleep(3000);
    await runCreate(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "PROJ-create", ev, ok) : 1);
}
