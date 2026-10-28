// LIVE proof, AUTO-011 boxes 1 and 2 (spec/09): a timed automation run starts (new worktree per run) while keys are typed in another worktree's
// terminal -> focus and keystrokes untouched; then opening the run's worktree shows all of the stand-in agent's startup output.
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, STANDIN_BODY, norm } from "./live-proj-common.mjs";
import { runCli, allPaneBuffers, rowsOf, selectRow, SHELL } from "./live-cli-common.mjs";

const focusOf = (app) =>
  app.evalJs(`(() => { const a = document.activeElement; return { tag: a?.tagName ?? null, cls: String(a?.className ?? ""), pane: a?.closest("section.pane")?.getAttribute("aria-label") ?? null, sel: [...document.querySelectorAll("[data-worktree]")].filter(e => e.querySelector(".sess.sel")).map(e => e.dataset.worktree).join(",") + "|" + (document.querySelector("button.branch")?.classList.contains("sel") ? "main" : "") }; })()`);
const joined = (t) => (t ?? "").replace(/\r?\n/g, "");

export async function run011(ctx, { check, log }) {
  const { app } = ctx;
  // The worktree the user keeps working in: made and activated first; its own shell pane is the caller and the typing target.
  const r0 = await runCli(ctx, "worktree create --name a --activate");
  const pa = r0.json?.worktree?.path ?? r0.json?.path ?? null;
  await poll(async () => { const s = (await rowsOf(app)).find((r) => r.sel); return s && norm(s.path) === norm(pa); }, 20000, 400);
  await sleep(4000);
  const rowsBefore = await rowsOf(app);
  log(`worktree a ready (exit ${r0.exit}); rows=${JSON.stringify(rowsBefore.map((r) => ({ label: r.label, sel: r.sel })))}`);

  // A daily automation, due in a minute or two (UTC), one fresh worktree per run.
  const due = new Date(Math.ceil((Date.now() + 80000) / 60000) * 60000);
  const hhmm = `${String(due.getUTCHours()).padStart(2, "0")}:${String(due.getUTCMinutes()).padStart(2, "0")}`;
  const cr = await runCli(ctx, `automations create --name live-timed --trigger daily --time ${hhmm} --timezone UTC --prompt hi --provider claude --workspace-mode new-per-run --enabled`);
  const id = cr.json?.id ?? cr.json?.automation?.id ?? null;
  log(`automations create (due ${hhmm} UTC): exit=${cr.exit} id=${id ? "<id>" : "none"} keys=${Object.keys(cr.json ?? {}).join(",")}${cr.exit === 0 ? "" : " raw=" + cr.raw.slice(0, 200).replace(/\s+/g, " ")}`);
  check("setup: the timed automation was created", cr.exit === 0 && !!id, `exit=${cr.exit}`);
  if (!id) return;

  // ---- box 1: type in a's terminal until the run's worktree appears ----
  await app.focusPane(SHELL, 0, ".xterm-helper-textarea");
  const f0 = await focusOf(app);
  log(`focus before: ${JSON.stringify(f0)}`);
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  let typed = "";
  const snaps = new Set([JSON.stringify(f0)]);
  let runRow = null;
  const t0 = Date.now();
  let stopAt = null;
  while (Date.now() - t0 < 300000) {
    const ch = alphabet[typed.length % 26];
    await app.cdp("insert", ch);
    typed += ch;
    snaps.add(JSON.stringify(await focusOf(app)));
    runRow ??= (await rowsOf(app)).find((r) => !rowsBefore.some((b) => norm(b.path) === norm(r.path))) ?? null;
    if (runRow && stopAt === null) { stopAt = Date.now() + 12000; log(`the run's worktree appeared after ${Math.round((Date.now() - t0) / 1000)} s (typed ${typed.length} chars so far)`); }
    if (stopAt && Date.now() > stopAt) break;
    await sleep(1000);
  }
  const typedText = typed;
  log(`typed ${typedText.length} chars one per second; distinct focus/selection snapshots seen: ${snaps.size}`);
  log(`snapshots: ${[...snaps].join(" ; ")}`);
  const timed = !!runRow;
  check("b1: the timer started a run (a new worktree) while typing", timed, `appeared=${timed}`);
  check("b1: focus and selection never moved from a's terminal", snaps.size === 1, `snapshots=${snaps.size}`);
  const shellText = joined(await ctx.text(0, SHELL));
  check("b1: every typed key landed in a's terminal, in order", shellText.includes(typedText), `typed ${typedText.length} chars, found=${shellText.includes(typedText)}`);
  log(`screenshot b1: ${await ctx.shot("AUTO-011-b1")}`);
  if (!timed) return;

  // ---- box 2: open the run's worktree ----
  const runPane = async () => (await allPaneBuffers(app, "section.pane[data-agent]")).filter((b) => b.agent === "claude");
  const hidden = await runPane();
  log(`before opening: claude panes=${hidden.length} shown=${JSON.stringify(hidden.map((b) => b.shown))}`);
  const label = (await rowsOf(app)).find((r) => norm(r.path) === norm(runRow.path))?.label;
  check("b2: open the run's worktree", await selectRow(app, label), `row ${label}`);
  await sleep(3000);
  const after = await runPane();
  const text = after[0]?.text ?? "";
  const have = ["stand-in for Claude Code", "ARGV:", "CWD:"].map((k) => [k, text.includes(k)]);
  log(`after opening: claude panes=${after.length} shown=${JSON.stringify(after.map((b) => b.shown))}; startup lines present: ${JSON.stringify(have)}`);
  log(`run pane's first lines: ${text.split("\n").filter(Boolean).slice(0, 3).map((l) => l.slice(0, 80)).join(" | ")}`);
  const cwd = text.split("\n").find((l) => l.startsWith("CWD:"))?.slice(4).trim();
  check("b2: the run's agent pane is in view with all its startup output", after.length === 1 && after[0].shown && have.every(([, ok]) => ok) && !!cwd && norm(cwd) === norm(runRow.path), `panes=${after.length} cwd=${cwd ? (norm(cwd) === norm(runRow.path) ? "<run worktree>" : "other") : "none"}`);
  check("b2: none of the typed keys leaked into the run's tab", !joined(text).includes(typedText.slice(0, 8)), "typed prefix absent");
  log(`screenshot b2: ${await ctx.shot("AUTO-011-b2")}`);
  log(`real agent programs under the app: ${JSON.stringify(await ctx.realAgents())}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("AUTO-011", { report: rep, standin: STANDIN_BODY });
    log(`real agent programs at start: ${JSON.stringify(await ctx.realAgents())}`);
    await sleep(3000);
    await run011(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "AUTO-011", ev, ok) : 1);
}
