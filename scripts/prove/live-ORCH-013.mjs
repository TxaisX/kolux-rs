// LIVE proof, ORCH-013 box 1 (spec/08): `dispatch --task <id> --to <handle> --inject` to an idle REAL Claude pane types the task brief in as a
// prompt and the agent starts work. The coordinator is a shell pane of the hidden app (kolux-dev from a Kolux terminal); the target is the
// Claude pane beside it. Asserted on Kolux's side: the dispatch receipt, the brief on the pane, the hook events, the dispatch/task state.
import { existsSync, readFileSync } from "node:fs";
import { scenario, sleep } from "./live-claude-common.mjs";
import { splitShell, cli, terminals, approveBash, flatScreen, idleNow } from "./live-orch-common.mjs";

const SPEC = "Create a file named hello.txt containing the word hi, then stop.";

await scenario(
  "ORCH-013",
  { cards: ["ORCH-013"], claudeArgs: "--model haiku --permission-mode manual --settings ${SETTINGS}", settings: { uiLook: "new" } },
  async (ctx, h) => {
    await splitShell(ctx, h.log);
    const rows = await terminals(ctx);
    const target = rows.find((r) => /claude/i.test(r.agent ?? ""));
    h.log(`terminals: ${JSON.stringify(rows.map((r) => ({ handle: r.handle, agent: r.agent })))}`);
    h.check("the Claude pane is a recognised agent terminal", !!target, target?.handle ?? "none");
    if (!target) return;
    await idleNow(ctx);

    // The shell pane is the coordinator: it makes a Run and a task whose spec is the tiny fixed prompt.
    const run = await cli(ctx, "orchestration run-create --objective live-proof-ORCH013");
    h.log(`run-create: exit=${run.exit} ${run.raw.slice(0, 160).replace(/\s+/g, " ")}`);
    const made = await cli(ctx, `orchestration task-create --spec "${SPEC}" --task-title hello`);
    h.log(`task-create: exit=${made.exit} ${made.raw.slice(0, 300).replace(/\s+/g, " ")}`);
    const taskId = made.json?.task?.id ?? made.json?.id ?? made.json?.taskId ?? null;
    h.check("a task was created from the spec", made.exit === 0 && !!taskId, String(taskId));
    if (!taskId) return;

    // Dry run first (no change), then the real inject dispatch.
    const tSend = Date.now();
    const d = await cli(ctx, `orchestration dispatch --task ${taskId} --to ${target.handle} --inject`);
    h.log(`dispatch --inject: exit=${d.exit} ${d.raw.slice(0, 500).replace(/\s+/g, " ")}`);
    h.check("the dispatch was accepted (exit 0)", d.exit === 0, `exit=${d.exit}`);
    let seen = null;
    const end = Date.now() + 45000;
    while (Date.now() < end && !seen) {
      const t = await flatScreen(ctx);
      if (/hello\.txt/i.test(t)) seen = t;
      else await sleep(500);
    }
    const lag = Date.now() - tSend;
    h.log(`brief text on the Claude pane after ${lag} ms: ${seen ? seen.slice(-400) : "(not seen)"}`);
    h.check("the pane received the brief (the task's spec is on Claude's screen)", !!seen, `${lag} ms`);
    const ev = (await ctx.events()).filter((e) => e.t >= tSend);
    h.check("the agent started work (a working event after the dispatch)", ev.some((e) => /working/i.test(e.state)), ev.map((e) => e.state).join(">"));

    // Let it finish the tiny job: answer its permission questions (file write) until it is idle again.
    for (let i = 0; i < 4; i++) {
      const q = await approveBash(ctx, h.log, i === 0 ? 60000 : 15000, "agent's permission question");
      if (!q) break;
    }
    await sleep(3000);
    await idleNow(ctx, 60000).catch(() => null);
    const file = `${ctx.repo}/hello.txt`;
    h.log(`hello.txt in the scratch repo: ${existsSync(file) ? JSON.stringify(readFileSync(file, "utf8").slice(0, 40)) : "(not there)"}`);
    const shown = await cli(ctx, `orchestration dispatch-show --task ${taskId}`);
    h.log(`dispatch-show: exit=${shown.exit} ${shown.raw.slice(0, 400).replace(/\s+/g, " ")}`);
    const w = await cli(ctx, "orchestration worker-list");
    h.log(`worker-list: exit=${w.exit} ${w.raw.slice(0, 400).replace(/\s+/g, " ")}`);
    h.log(`screenshot: ${await h.shot("after-dispatch")}`);
    h.log(`events since the dispatch: ${(await ctx.events()).filter((e) => e.t >= tSend).map((e) => `${e.t - tSend}ms ${e.state}${e.tool ? `/${e.tool}` : ""}`).join(" > ")}`);
  },
);
