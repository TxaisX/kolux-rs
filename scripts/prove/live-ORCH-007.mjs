// LIVE proof, ORCH-007 box 1 (spec/08): an idle REAL Claude pane tied to a Run gets Kolux's one-line pointer typed in when a worker
// sends to run:<id>, and the agent then runs the check. Claude ties itself to the Run through its own Bash tool (--from may only name
// the calling terminal, so a shell pane cannot bind another pane); the "worker" is a shell pane of the same hidden app using kolux-dev.
import { scenario, send, sleep } from "./live-claude-common.mjs";
import { splitShell, cli, terminals, approveBash, flatScreen, idleNow } from "./live-orch-common.mjs";

const OBJECTIVE = "live-proof-ORCH007";
const SUBJECT = "LIVEPING7731";

await scenario(
  "ORCH-007",
  { cards: ["ORCH-007"], claudeArgs: "--model haiku --permission-mode manual --settings ${SETTINGS}", settings: { uiLook: "new" } },
  async (ctx, h) => {
    await splitShell(ctx, h.log);
    const rows0 = await terminals(ctx);
    const me = rows0.find((r) => /claude/i.test(r.agent ?? ""));
    h.log(`terminals: ${JSON.stringify(rows0.map((r) => ({ handle: r.handle, agent: r.agent, program: r.program })))}`);
    h.check("the Claude pane is a recognised agent terminal", !!me, me?.handle ?? "none");

    // The coordinator ties itself to a new Run with its own Bash tool.
    await send(ctx, `Run exactly this shell command with the Bash tool, then stop and say nothing else: kolux-dev orchestration run-create --objective ${OBJECTIVE}`);
    const asked = await approveBash(ctx, h.log, 90000, "coordinator's run-create question");
    h.check("Claude asked to run run-create and was allowed once", !!asked, asked ? "yes" : "no question");
    await sleep(3000);
    await idleNow(ctx);
    const runs = await cli(ctx, "orchestration run-list");
    const run = (runs.json?.runs ?? runs.json?.items ?? []).find((r) => JSON.stringify(r).includes(OBJECTIVE));
    h.log(`run-list: exit=${runs.exit} ${runs.raw.slice(0, 300).replace(/\s+/g, " ")}`);
    const runId = run?.id ?? null;
    h.check("a Run for the objective exists (the coordinator tied itself to it)", !!runId, String(runId));
    if (!runId) return;
    const idle = await idleNow(ctx);
    h.log(`coordinator idle before the send: last event ${idle?.state}`);

    // The worker sends to the Run.
    const tBefore = Date.now();
    const sent = await cli(ctx, `orchestration send --subject ${SUBJECT} --to run:${runId} --body "live proof ping"`);
    const tSent = Date.now();
    h.log(`worker send: exit=${sent.exit} ${sent.raw.slice(0, 200).replace(/\s+/g, " ")}`);
    h.check("the send succeeded", sent.exit === 0, `exit=${sent.exit}`);
    let line = null;
    const end = Date.now() + 60000;
    while (Date.now() < end && !line) {
      const t = await flatScreen(ctx);
      const m = /(\d+ orchestration messages? (?:is|are) waiting for you in [^;]+; read them with: \S+ orchestration check --run \S+)/.exec(t);
      if (m) line = m[1];
      else await sleep(500);
    }
    const lag = Date.now() - tSent;
    h.log(`pointer line on Claude's screen after ${lag} ms (send command ran for ${tSent - tBefore} ms): ${line ?? "(none)"}`);
    h.check("within a few seconds the coordinator pane shows the pointer line", !!line && lag < 15000, `${lag} ms`);
    h.check("the line gives the count, the Run and the exact check command", !!line && line.includes(runId) && /^1 orchestration message is waiting/.test(line) && line.includes(`orchestration check --run ${runId}`), line ?? "-");

    // The agent runs check on its own.
    const ask2 = await approveBash(ctx, h.log, 90000, "agent's own follow-up question");
    h.check("the agent went on to run a Bash command (the check) on its own", !!ask2 && /orchestration check/.test(ask2), ask2 ? ask2.slice(Math.max(0, ask2.search(/Bash command/i)), ask2.search(/Do you want/i)).slice(0, 200) : "no question");
    await sleep(4000);
    await idleNow(ctx);
    const after = await flatScreen(ctx);
    h.check("the check output reached the agent (it shows the message subject)", after.includes(SUBJECT), `${after.includes(SUBJECT)}`);
    h.log(`screenshot: ${await h.shot("after-check")}`);
    const ev = (await ctx.events()).filter((e) => e.t >= tSent).map((e) => `${e.t - tSent}ms ${e.state}${e.tool ? `/${e.tool}` : ""}`);
    h.log(`events since the send: ${ev.join(" > ")}`);
  },
);
