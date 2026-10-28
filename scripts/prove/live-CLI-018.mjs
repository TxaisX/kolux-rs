// LIVE proof, CLI-018 boxes 1 and 2 (spec/20): `worktree create --name b --agent claude --prompt hi` from worktree A makes b under A,
// starts the agent in b's first terminal with the prompt, and leaves the active worktree alone; with --activate b is brought into view.
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, STANDIN_BODY, norm } from "./live-proj-common.mjs";
import { runCli, allPaneBuffers, rowsOf } from "./live-cli-common.mjs";

const pathOf = (j) => j?.worktree?.path ?? j?.path ?? null;
const claudeIn = async (app, folder) => {
  const bufs = await allPaneBuffers(app, 'section.pane[data-agent*="claude"]');
  return bufs.find((b) => b.text?.split("\n").some((l) => l.startsWith("CWD:") && norm(l.slice(4).trim()) === norm(folder))) ?? null;
};

export async function run018(ctx, { check, log }) {
  const { app } = ctx;
  // A is a real worktree (the main checkout is the project row, not a nestable one): made and activated first, its own shell pane the caller.
  const r0 = await runCli(ctx, "worktree create --name a --activate");
  const pa = pathOf(r0.json);
  log(`A made: exit=${r0.exit} path-reported=${!!pa}`);
  await poll(async () => { const s = (await rowsOf(app)).find((r) => r.sel); return s && norm(s.path) === norm(pa); }, 20000, 400);
  await sleep(4000);
  const cur = await runCli(ctx, "worktree current");
  log(`from A's pane, worktree current -> ${norm(pathOf(cur.json) ?? cur.raw.slice(0, 120))}`);
  const a = { path: pa, label: "a" };
  check("setup: the calling pane is A's own shell", norm(pathOf(cur.json) ?? "") === norm(pa), `current=${norm(pathOf(cur.json) ?? "")}`);

  const focusOf = () => app.evalJs(`(() => { const a = document.activeElement; return { tag: a?.tagName ?? null, cls: String(a?.className ?? ""), pane: a?.closest("section.pane")?.getAttribute("aria-label") ?? null }; })()`);
  const f0 = await focusOf();
  log(`keyboard focus before: ${JSON.stringify(f0)}`);
  // ---- box 1: no --activate ----
  const r1 = await runCli(ctx, "worktree create --name b --agent claude --prompt hi");
  log(`b1 exit=${r1.exit} keys=${Object.keys(r1.json ?? {}).join(",")}`);
  const pb = pathOf(r1.json);
  check("b1: the command exits 0 and reports b made by the CLI", r1.exit === 0 && !!pb, `exit=${r1.exit} path-reported=${!!pb}`);
  check("b1: A is b's recorded parent", norm(r1.json?.parent ?? "") === norm(a.path), `parent=${norm(r1.json?.parent ?? "")} A=${norm(a.path)}`);
  check("b1: the receipt says activated=false", r1.json?.activated === false, `activated=${r1.json?.activated}`);
  await poll(async () => (await rowsOf(app)).some((r) => norm(r.path) === norm(pb)), 15000, 400);
  const rows1 = await rowsOf(app);
  const rb = rows1.find((r) => norm(r.path) === norm(pb));
  const ra = rows1.find((r) => norm(r.path) === norm(a.path));
  log(`rows after: ${JSON.stringify(rows1.map((r) => ({ label: r.label, sel: r.sel, depth: r.depth })))}`);
  check("b1: b is in the sidebar, nested one step under A", !!rb && !!ra && rb.depth === ra.depth + 1, `b.depth=${rb?.depth} A.depth=${ra?.depth}`);
  check("b1: the active worktree is still A", !!ra?.sel && !rb?.sel, `A.sel=${ra?.sel} b.sel=${rb?.sel}`);
  const paneB = await poll(async () => { const p = await claudeIn(app, pb); return p?.text?.includes("ARGV:") ? p : null; }, 40000, 800);
  log(`claude pane in b: ${paneB ? "found" : "none"}; shown=${paneB?.shown}`);
  const argv = paneB?.text?.split("\n").find((l) => l.startsWith("ARGV:")) ?? null;
  log(`b's first terminal ARGV line: ${argv}`);
  check("b1: Claude started in b's folder with the prompt", !!paneB && /\bhi\b/.test(argv ?? ""), `argv=${argv}`);
  const still = (await rowsOf(app)).find((r) => r.sel);
  check("b1: still A after the agent started", norm(still?.path ?? "") === norm(a.path), `selected=${still?.label}`);
  const f1 = await focusOf();
  log(`keyboard focus after: ${JSON.stringify(f1)}`);
  check("b1: keyboard focus stays where it was (A's pane)", !!f0.pane && f1.pane === f0.pane && f1.cls === f0.cls, `before=${f0.pane}/${f0.cls} after=${f1.pane}/${f1.cls}`);
  log(`screenshot b1: ${await ctx.shot("CLI-018-b1")}`);

  // ---- box 2: --activate (a second worktree, c, since b exists) ----
  const r2 = await runCli(ctx, "worktree create --name c --agent claude --prompt hi --activate");
  const pc = pathOf(r2.json);
  log(`b2 exit=${r2.exit} activated=${r2.json?.activated}`);
  check("b2: exit 0 and the receipt says activated=true", r2.exit === 0 && r2.json?.activated === true, `exit=${r2.exit} activated=${r2.json?.activated}`);
  const sel = await poll(async () => { const s = (await rowsOf(app)).find((r) => r.sel); return s && norm(s.path) === norm(pc) ? s : null; }, 20000, 400);
  check("b2: c is the selected worktree", !!sel, `selected=${(await rowsOf(app)).find((r) => r.sel)?.label}`);
  const paneC = await poll(async () => { const p = await claudeIn(app, pc); return p?.shown && p.text?.includes("ARGV:") ? p : null; }, 40000, 800);
  const argvC = paneC?.text?.split("\n").find((l) => l.startsWith("ARGV:")) ?? null;
  log(`c's claude pane shown=${paneC?.shown} ARGV: ${argvC}`);
  check("b2: c's Claude pane is in view with the prompt", !!paneC && /\bhi\b/.test(argvC ?? ""), `argv=${argvC}`);
  log(`screenshot b2: ${await ctx.shot("CLI-018-b2")}`);
  log(`real agent programs under the app: ${JSON.stringify(await ctx.realAgents())}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("CLI-018", { report: rep, standin: STANDIN_BODY });
    log(`real agent programs at start: ${JSON.stringify(await ctx.realAgents())}`);
    await sleep(3000);
    await run018(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "CLI-018", ev, ok) : 1);
}
