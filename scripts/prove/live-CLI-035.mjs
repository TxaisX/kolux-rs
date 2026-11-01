// LIVE proof, CLI-035 box 1 (spec/20): from a shell pane of the hidden app, `kolux-dev orchestration worker-start --spec x --tier build`
// starts a REAL Claude worker on the model routed for build and prints a ready receipt. The routing is a saved Settings pick (build ->
// haiku, so the session is cheap); no --agent is given, so the tier runs on the default agent. Asserted: the receipt, the worker's
// process command line (the resolved exe and the --model it got) and the sidebar worktree/terminal.
import { scenario, sleep, CLAUDE_EXE } from "./live-claude-common.mjs";
import { cli, terminals } from "./live-orch-common.mjs";
import { rowsOf, selectRow } from "./live-cli-common.mjs";

const SPEC = "Create a file named hello.txt containing the word hi, then stop.";
const norm = (p) => String(p ?? "").replace(/\\/g, "/").toLowerCase();

await scenario(
  "CLI-035",
  {
    cards: ["CLI-035"],
    noOpen: true,
    claudeArgs: "--permission-mode manual --settings ${SETTINGS}",
    settings: { uiLook: "new", modelRouting: { claude: { build: { model: "haiku" } } } },
  },
  async (ctx, h) => {
    const { app } = ctx;
    const before = await terminals(ctx);
    h.log(`terminals before: ${JSON.stringify(before.map((r) => ({ handle: r.handle, agent: r.agent, program: r.program })))}`);
    const t0 = Date.now();
    const r = await cli(ctx, `orchestration worker-start --spec "${SPEC}" --tier build --timeout-ms 90000`, { timeout: 150000 });
    const j = r.json;
    h.log(`worker-start: exit=${r.exit} in ${Date.now() - t0} ms; receipt: ${JSON.stringify({ status: j?.status, stage: j?.stage, agent: j?.agent, program: j?.program, model: j?.model, effort: j?.effort, tier: j?.tier, launch: j?.launch, created: j?.worktree?.created, terminals: j?.terminals, trust: j?.trust, hint: String(j?.hint ?? "").slice(0, 60) })}`);
    h.check("worker-start exited 0 with a ready receipt", r.exit === 0 && j?.status === "ready", `exit=${r.exit} status=${j?.status}`);
    h.check("the receipt names the build tier, the Claude agent and the model routed for build (haiku)", j?.tier === "build" && j?.agent === "claude" && j?.model === "haiku", `tier=${j?.tier} agent=${j?.agent} model=${j?.model} effort=${j?.effort}`);
    h.check("the worker is a terminal in a new worktree", (j?.terminals ?? []).some((t) => t.role === "worker") && !!j?.worktree?.created, JSON.stringify(j?.terminals));

    // The real process: the exe it resolved and the model it was started with.
    const tree = await app.treeOf(app.pid);
    const claudes = tree.filter((p) => /^claude(\.exe)?$/i.test(p.name));
    const lines = (await app.ps(`Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)|$($_.CommandLine)" }`)).split(/\r?\n/).filter(Boolean);
    const mine = lines.filter((l) => claudes.some((c) => l.startsWith(`${c.pid}|`)));
    for (const l of mine) h.log(`worker process: ${l.replace(/\\/g, "/").slice(0, 330)}`);
    h.check("exactly one Claude process runs under the app and its exe is the Claude on the registry PATH", mine.length === 1 && norm(mine[0].split("|")[1]) === norm(CLAUDE_EXE), `count=${mine.length} exe=${mine[0]?.split("|")[1]}`);
    h.check("it was started with --model haiku (the routed model)", mine.length === 1 && /--model[ =]haiku/.test(mine[0]), (mine[0] ?? "").replace(/\\/g, "/").slice(-160));
    const w = await cli(ctx, "orchestration worker-list");
    h.log(`worker-list: exit=${w.exit} ${w.raw.slice(0, 400).replace(/\s+/g, " ")}`);
    const wpath = j?.worktree?.path;
    const after = await terminals(ctx);
    h.log(`terminals after: ${JSON.stringify(after.map((r) => ({ handle: r.handle, agent: r.agent, worktree: r.worktree })))}`);

    // Show the worker (answering only Claude's folder-trust question) so the screenshot and the screen reading are real.
    const row = (await rowsOf(app)).find((x) => norm(x.path) === norm(wpath));
    h.log(`sidebar row of the new worktree: ${row ? row.label : "(none)"}`);
    if (row) {
      await selectRow(app, row.label);
      await sleep(2500);
      try {
        const screen = await ctx.ready(120000);
        h.log(`worker screen: ${screen.split("\n").map((l) => l.trim()).filter(Boolean).slice(-6).join(" | ").slice(0, 300)}`);
      } catch (e) {
        h.log(`worker screen not ready: ${String(e.message).slice(0, 200)}`);
      }
      h.log(`worker events: ${(await ctx.events()).map((e) => `${e.state}${e.tool ? `/${e.tool}` : ""}`).join(" > ")}`);
      h.log(`screenshot: ${await h.shot("worker")}`);
    }
  },
);

