// LIVE proof, SAFE-023 box 1 (spec/10), after MERGE 411: creating a worktree and launching a REAL Claude (test account A) with a prompt
// shows NO folder-trust menu, and the prompt reaches the agent. The trust question is never answered here: seeing it fails the box.
// Driven by `kolux-dev orchestration worker-start` (new worktree + Claude + opening prompt) from a shell pane of the hidden app.
import { scenario, sleep } from "./live-claude-common.mjs";
import { cli } from "./live-orch-common.mjs";
import { rowsOf, selectRow } from "./live-cli-common.mjs";
import { watchPanes, trustLogLines, TRUST_RE } from "./live-trust-common.mjs";

const SPEC = "Create a file named hello.txt containing the word hi, then stop.";
const norm = (p) => String(p ?? "").replace(/\\/g, "/").toLowerCase();

await scenario(
  "SAFE-023",
  {
    cards: ["SAFE-023"],
    noOpen: true,
    claudeArgs: "--permission-mode manual --settings ${SETTINGS}",
    settings: { uiLook: "new", modelRouting: { claude: { build: { model: "haiku" } } } },
  },
  async (ctx, h) => {
    const { app } = ctx;
    const r = await cli(ctx, `orchestration worker-start --spec "${SPEC}" --tier build --timeout-ms 90000`, { timeout: 150000 });
    const j = r.json;
    h.log(`worker-start: exit=${r.exit}; receipt: ${JSON.stringify({ status: j?.status, agent: j?.agent, model: j?.model, worktreeCreated: j?.worktree?.created, trust: j?.trust }).slice(0, 400)}`);
    h.check("worker-start made a NEW worktree and launched Claude", r.exit === 0 && j?.status === "ready" && !!j?.worktree?.created && j?.agent === "claude", `exit=${r.exit} status=${j?.status} agent=${j?.agent}`);
    const wpath = j?.worktree?.path;
    h.log(`fresh worktree: ${norm(wpath)}`);
    const row = (await rowsOf(app)).find((x) => norm(x.path) === norm(wpath));
    h.check("the new worktree is in the sidebar", !!row, row ? row.label : "no row");
    if (row) await selectRow(app, row.label);
    await sleep(2000);
    const panes = await watchPanes(app, 1, 120000, h.log);
    const p = panes[0];
    h.log(`pane state: ${p?.state}; screen: ${(p?.text ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(-6).join(" | ").slice(0, 320)}`);
    h.check("Claude shows NO folder-trust menu", !!p && !TRUST_RE.test(p.text) && p.state !== "trust", `state=${p?.state}`);
    // The prompt reached the agent: the pane left idle (a Working event) or the spec text shows on screen.
    const reached = await ctx.waitEvent((e) => /work|tool|prompt/i.test(String(e.state)) , 90000, "a Working event").catch(() => null);
    const text = (await ctx.screenText()) ?? "";
    h.log(`events: ${(await ctx.events()).map((e) => `${e.state}${e.tool ? `/${e.tool}` : ""}`).join(" > ").slice(0, 200)}`);
    h.check("the prompt reached the agent (a Working event or the spec text on the screen)", !!reached || /hello\.txt/i.test(text), `event=${reached ? reached.state : "none"} specOnScreen=${/hello\.txt/i.test(text)}`);
    for (const l of trustLogLines(ctx.TEMP)) h.log(`kolux.log: ${l}`);
    h.log(`screenshot: ${await h.shot("worker")}`);
  },
);
